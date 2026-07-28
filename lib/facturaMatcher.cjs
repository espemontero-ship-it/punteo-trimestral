const { query } = require('./db.cjs');
const { registrarNota } = require('./memoria.cjs');

const TOLERANCIA = 0.01;
const TOLERANCIA_COMBO = 0.02;

async function siguienteNumero(trimestreId) {
  const { rows } = await query(
    'SELECT COALESCE(MAX(numero), 0) AS max FROM facturas WHERE trimestre_id = $1',
    [trimestreId]
  );
  return rows[0].max + 1;
}

// Si proveedorClave es null, busca entre TODOS los movimientos pendientes del
// trimestre (para facturas subidas antes de que exista el excel/el grupo).
async function movimientosPendientes(trimestreId, proveedorClave) {
  if (proveedorClave) {
    const [hoja, ...resto] = proveedorClave.split('::');
    const clave = resto.join('::');
    const { rows } = await query(
      `SELECT id, hoja, clave, importe, fecha, concepto FROM movimientos
       WHERE trimestre_id = $1 AND hoja = $2 AND clave = $3
         AND estado IN ('sin_resolver', 'pedida_pendiente')`,
      [trimestreId, hoja, clave]
    );
    return rows;
  }
  const { rows } = await query(
    `SELECT id, hoja, clave, importe, fecha, concepto FROM movimientos
     WHERE trimestre_id = $1 AND estado IN ('sin_resolver', 'pedida_pendiente')`,
    [trimestreId]
  );
  return rows;
}

async function facturasSinResolver(trimestreId, proveedorClave, excluirId) {
  // Las dos ramas usan un número distinto de parámetros ($3 vs $2 para
  // excluirId) — pasar un array de 3 valores cuando la consulta solo
  // referencia $1 y $2 hace que Postgres no pueda determinar el tipo de un
  // parámetro que no aparece en ningún sitio del texto de la consulta.
  const { rows } = await query(
    proveedorClave
      ? `SELECT id, numero, totales, importes, fechas FROM facturas
         WHERE trimestre_id = $1 AND proveedor_clave = $2 AND estado IN ('sin_match', 'revisar') AND id != $3`
      : `SELECT id, numero, totales, importes, fechas FROM facturas
         WHERE trimestre_id = $1 AND proveedor_clave IS NULL AND estado IN ('sin_match', 'revisar') AND id != $2`,
    proveedorClave ? [trimestreId, proveedorClave, excluirId] : [trimestreId, excluirId]
  );
  return rows;
}

function montoCaracteristico(totales, importes) {
  if (totales && totales.length) return Math.max(...totales);
  if (importes && importes.length) return Math.max(...importes);
  return null;
}

function diasEntre(a, b) {
  if (!a || !b) return null;
  return Math.abs((new Date(a).getTime() - new Date(b).getTime()) / 86400000);
}

// Intenta emparejar una factura ya guardada (con o sin proveedor asignado)
// contra los movimientos pendientes. Si no hay proveedor asignado, busca en
// todo el trimestre — pensado para facturas subidas antes de que exista el
// excel del banco. Nunca resuelve nada ambiguo sola.
async function intentarMatch(trimestreId, factura) {
  const { id: facturaId, numero, proveedor_clave: proveedorClave, totales, importes, fechas, es_imagen: esImagen, textoMayus, concepto } = factura;

  if (esImagen) {
    return { tipo: 'imagen_sin_texto', numero, facturaId, detalle: 'Es una imagen — no se puede leer el importe automáticamente, revisa a mano.' };
  }

  const monto = montoCaracteristico(totales, importes);
  if (monto === null) {
    // Se incluye un trozo del texto extraído para poder ver por qué no
    // encontró el importe, sin tener que adivinar a ciegas otra vez.
    const muestra = (textoMayus || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    return {
      tipo: 'sin_importe', numero, facturaId,
      detalle: muestra
        ? `No se ha reconocido ningún importe. Texto leído: "${muestra}${textoMayus.length > 200 ? '...' : ''}"`
        : 'No se ha reconocido ningún importe en el archivo (no se pudo extraer texto). Revisa a mano.',
    };
  }

  const pendientes = await movimientosPendientes(trimestreId, proveedorClave);
  if (pendientes.length === 0) {
    return {
      tipo: 'sin_movimientos', numero, facturaId,
      detalle: 'Aún no hay movimientos de banco con los que comparar — se intentará automáticamente en cuanto subas o actualices el excel.',
    };
  }

  const usaTotal = (totales || []).includes(monto);
  const fechaFactura = fechas && fechas[0];

  const candidatos = pendientes
    .filter(m => Math.abs(Number(m.importe) - monto) <= TOLERANCIA)
    .map(m => ({ ...m, dias: diasEntre(m.fecha, fechaFactura) }))
    .sort((a, b) => (a.dias ?? 9999) - (b.dias ?? 9999));

  if (candidatos.length === 1 || (candidatos.length > 1 && candidatos[0].dias !== null && candidatos[0].dias < (candidatos[1]?.dias ?? 9999))) {
    const movimiento = candidatos[0];
    // El concepto escrito al subir la factura (si lo hay) se usa como nota en
    // vez del número de factura — así no hace falta escribirlo otra vez.
    const nota = concepto || String(numero);
    await resolverMovimiento(movimiento.id, nota, [facturaId]);
    await query(
      `UPDATE facturas SET estado = 'matcheada', proveedor_clave = COALESCE(proveedor_clave, $2) WHERE id = $1`,
      [facturaId, `${movimiento.hoja}::${movimiento.clave}`]
    );
    return {
      tipo: 'match_directo', numero, facturaId, movimientoId: movimiento.id,
      detalle: usaTotal
        ? `Importe reconocido como total (${monto.toFixed(2)}€) — coincide con una única línea pendiente.`
        : `Importe (${monto.toFixed(2)}€) coincide, pero no aparece junto a la palabra "Total" en el PDF — verifícalo.`,
    };
  }

  if (candidatos.length > 1) {
    return {
      tipo: 'ambiguo', numero, facturaId, facturaConcepto: concepto,
      candidatos: candidatos.map(c => ({ movimientoId: c.id, concepto: c.concepto, importe: c.importe, fecha: c.fecha })),
      detalle: `${candidatos.length} líneas pendientes tienen el mismo importe (${monto.toFixed(2)}€) — elige a cuál corresponde.`,
    };
  }

  // Sin match directo: probar combinación con otra factura sin resolver (del mismo proveedor si lo hay).
  const otras = await facturasSinResolver(trimestreId, proveedorClave, facturaId);
  for (const otra of otras) {
    const montoOtra = montoCaracteristico(otra.totales, otra.importes);
    if (montoOtra === null) continue;
    const suma = monto + montoOtra;
    const match = pendientes.find(m => Math.abs(Number(m.importe) - suma) <= TOLERANCIA_COMBO);
    if (match) {
      return {
        tipo: 'combo_sugerido', numero, facturaId, facturaConcepto: concepto,
        movimientoId: match.id,
        otraFacturaNumero: otra.numero,
        otraFacturaId: otra.id,
        detalle: `Esta factura (${monto.toFixed(2)}€) + la factura ${otra.numero} (${montoOtra.toFixed(2)}€) suman ${suma.toFixed(2)}€, el importe de una línea pendiente — confirma si es correcto.`,
      };
    }
  }

  return { tipo: 'sin_match', numero, facturaId, detalle: `Importe (${monto.toFixed(2)}€) no coincide con ninguna línea pendiente, ni sola ni combinada. Revisa a mano.` };
}

// Guarda una factura recién subida. `hoja`/`clave` son opcionales: si aún no
// existe el excel del banco (o no se sabe el proveedor), se sube sin asignar
// y se reintentará el match automáticamente cuando haya movimientos.
async function procesarFacturaSubida({ trimestreId, hoja, clave, rutaBlob, nombreOriginal, concepto, analisis }) {
  await query(`INSERT INTO trimestres (id) VALUES ($1) ON CONFLICT DO NOTHING`, [trimestreId]);
  const proveedorClave = hoja && clave ? `${hoja}::${clave}` : null;
  const numero = await siguienteNumero(trimestreId);

  const insert = await query(
    `INSERT INTO facturas (trimestre_id, proveedor_clave, ruta_blob, nombre_original, numero,
                            importes, totales, fechas, es_imagen, concepto, estado)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'sin_match')
     RETURNING *`,
    [
      trimestreId, proveedorClave, rutaBlob, nombreOriginal, numero,
      analisis.importes, analisis.totales, analisis.fechas.map(f => f.toISOString().slice(0, 10)),
      analisis.esImagen, concepto || null,
    ]
  );
  const factura = { ...insert.rows[0], textoMayus: analisis.textoMayus };

  const resultado = await intentarMatch(trimestreId, factura);
  await aplicarEstado(factura.id, resultado);
  return resultado;
}

// Se llama tras importar/actualizar el excel del banco: reintenta el match de
// todas las facturas que se quedaron sin resolver (incluidas las subidas
// sueltas, sin proveedor, antes de que existiera el excel).
async function reintentarPendientes(trimestreId) {
  const { rows: pendientes } = await query(
    `SELECT * FROM facturas WHERE trimestre_id = $1 AND estado IN ('sin_match', 'revisar') AND es_imagen = false`,
    [trimestreId]
  );
  let resueltas = 0;
  for (const factura of pendientes) {
    const resultado = await intentarMatch(trimestreId, factura);
    await aplicarEstado(factura.id, resultado);
    if (resultado.tipo === 'match_directo') resueltas++;
  }
  return { revisadas: pendientes.length, resueltas };
}

// Fija a mano el importe de una factura que no se pudo leer del PDF (imagen,
// tabla ilegible, divisa rara...) y relanza el mismo matching automático que
// se usa al subir — evita tener que buscar la línea a mano en la tabla.
async function confirmarImporteManual(facturaId, importe) {
  const { rows } = await query(
    `UPDATE facturas SET importes = ARRAY[$2::numeric], totales = ARRAY[$2::numeric]
     WHERE id = $1 RETURNING *`,
    [facturaId, importe]
  );
  if (rows.length === 0) throw new Error('Factura no encontrada.');

  const factura = rows[0];
  const resultado = await intentarMatch(factura.trimestre_id, factura);
  await aplicarEstado(factura.id, resultado);
  return resultado;
}

async function aplicarEstado(facturaId, resultado) {
  const estado = resultado.tipo === 'match_directo' ? 'matcheada'
    : resultado.tipo === 'sin_movimientos' ? 'sin_match'
    : 'revisar';
  await query(`UPDATE facturas SET estado = $2 WHERE id = $1 AND estado != 'matcheada'`, [facturaId, estado]);
}

async function resolverMovimiento(movimientoId, nota, facturaIds) {
  const { rows } = await query(
    `UPDATE movimientos SET estado = 'resuelta', nota_final = $1 WHERE id = $2 RETURNING hoja, clave`,
    [nota, movimientoId]
  );
  for (const facturaId of facturaIds) {
    await query(
      `INSERT INTO movimiento_facturas (movimiento_id, factura_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [movimientoId, facturaId]
    );
  }
  if (rows.length) await registrarNota(rows[0].hoja, rows[0].clave, nota);
}

// Confirmación manual de un caso ambiguo o de combinación sugerida.
async function confirmarMatch(movimientoId, facturaIds, notaFinal) {
  await resolverMovimiento(movimientoId, notaFinal, facturaIds);
  await query(
    `UPDATE facturas SET estado = 'matcheada' WHERE id = ANY($1::bigint[])`,
    [facturaIds]
  );
}

module.exports = { procesarFacturaSubida, confirmarMatch, confirmarImporteManual, reintentarPendientes, siguienteNumero };
