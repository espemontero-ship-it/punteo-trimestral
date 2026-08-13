const { query } = require('./db.cjs');
const { registrarNota } = require('./memoria.cjs');
const { descargarBlob } = require('./blob.cjs');
const { analizarBuffer } = require('./facturas.cjs');
const { leerFacturaConIA } = require('./facturaIA.cjs');

const TOLERANCIA = 0.01;
// Un combo de varias facturas contra una única línea del banco puede no
// cuadrar exacto por una comisión de transferencia que el banco descuenta --
// tolerancia más generosa que el match directo (una factura sola sí tiene
// que cuadrar al céntimo). Fija, no escala con el número de facturas: una
// transferencia solo lleva una comisión, no una por factura agrupada.
const TOLERANCIA_COMBO = 0.5;
// Cuántas facturas sueltas se prueban combinadas como máximo -- más allá de
// esto el número de combinaciones crece muy rápido y el riesgo de un
// falso positivo (una suma que cuadra por casualidad) también.
const MAX_FACTURAS_EN_COMBO = 3;

// trimestreId solo se pasa desde el flujo de colaboradores/lotes (que sigue
// teniendo trimestre por ahora, ver lib/lotes.cjs) -- las facturas sueltas o
// de proveedor (flujo principal, continuo) usan una numeración propia,
// trimestre_id IS NULL, independiente de esa.
async function siguienteNumero(trimestreId) {
  const { rows } = trimestreId
    ? await query('SELECT COALESCE(MAX(numero), 0) AS max FROM facturas WHERE trimestre_id = $1', [trimestreId])
    : await query('SELECT COALESCE(MAX(numero), 0) AS max FROM facturas WHERE trimestre_id IS NULL');
  return rows[0].max + 1;
}

// Si proveedorClave es null, busca entre TODOS los movimientos pendientes
// (para facturas subidas antes de que exista el excel/el grupo). Los
// movimientos ya no pertenecen a ningún trimestre -- son un único histórico.
async function movimientosPendientes(proveedorClave) {
  if (proveedorClave) {
    const [hoja, ...resto] = proveedorClave.split('::');
    const clave = resto.join('::');
    const { rows } = await query(
      `SELECT id, hoja, clave, importe, fecha, concepto FROM movimientos
       WHERE hoja = $1 AND clave = $2 AND estado IN ('sin_resolver', 'pedida_pendiente')`,
      [hoja, clave]
    );
    return rows;
  }
  const { rows } = await query(
    `SELECT id, hoja, clave, importe, fecha, concepto FROM movimientos
     WHERE estado IN ('sin_resolver', 'pedida_pendiente')`
  );
  return rows;
}

// Limitado a trimestre_id IS NULL (facturas del flujo principal, no de lote)
// para no mezclar el matching automático con el flujo de colaboradores.
async function facturasSinResolver(proveedorClave, excluirId) {
  const { rows } = await query(
    proveedorClave
      ? `SELECT id, numero, totales, importes, fechas FROM facturas
         WHERE trimestre_id IS NULL AND proveedor_clave = $1 AND estado IN ('sin_match', 'revisar') AND id != $2`
      : `SELECT id, numero, totales, importes, fechas FROM facturas
         WHERE trimestre_id IS NULL AND proveedor_clave IS NULL AND estado IN ('sin_match', 'revisar') AND id != $1`,
    proveedorClave ? [proveedorClave, excluirId] : [excluirId]
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
// contra los movimientos pendientes de todo el histórico. Nunca resuelve nada
// ambiguo sola.
async function intentarMatch(factura) {
  const { id: facturaId, numero, proveedor_clave: proveedorClave, totales, importes, fechas, es_imagen: esImagen, textoMayus, concepto } = factura;

  const monto = montoCaracteristico(totales, importes);

  // El aviso de "es imagen" solo tiene sentido mientras no se sepa el importe
  // -- si ya se ha fijado a mano (o vinculado manualmente), monto no es null
  // y hay que seguir e intentar el match, no repetir algo que la usuaria ya
  // sabe y por lo que precisamente acaba de escribir el importe.
  if (monto === null) {
    const notaIA = (textoMayus || '').startsWith('IA: ') ? textoMayus.slice(4) : null;

    if (esImagen) {
      return {
        tipo: 'imagen_sin_texto', numero, facturaId,
        detalle: notaIA
          ? `Es una imagen — ${notaIA}`
          : 'Es una imagen — no se ha podido leer el importe automáticamente, revisa a mano.',
      };
    }
    if (notaIA) {
      return { tipo: 'sin_importe', numero, facturaId, detalle: `No se ha reconocido ningún importe. ${notaIA}` };
    }
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

  const pendientes = await movimientosPendientes(proveedorClave);
  if (pendientes.length === 0) {
    return {
      tipo: 'sin_movimientos', numero, facturaId,
      detalle: 'Aún no hay movimientos de banco con los que comparar — se intentará automáticamente en cuanto subas o actualices el excel.',
    };
  }

  const usaTotal = (totales || []).includes(monto);
  const fechaFactura = fechas && fechas[0];

  // monto viene siempre positivo (extraerCandidatos descarta importes <= 0),
  // pero un gasto real en el banco se guarda en negativo -- comparar
  // directamente m.importe contra monto nunca daba match para ningún gasto
  // (la diferencia siempre salía enorme). Se compara en valor absoluto.
  const candidatos = pendientes
    .filter(m => Math.abs(Math.abs(Number(m.importe)) - monto) <= TOLERANCIA)
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

  // Sin match directo: probar combinación con otras facturas sin resolver
  // (del mismo proveedor si lo hay) -- primero de 2 en 2, luego de 3 en 3
  // (hasta MAX_FACTURAS_EN_COMBO en total), para preferir la explicación más
  // simple cuando varias combinaciones cuadrarían igual.
  const otras = await facturasSinResolver(proveedorClave, facturaId)
    .then(rows => rows
      .map(o => ({ ...o, monto: montoCaracteristico(o.totales, o.importes) }))
      .filter(o => o.monto !== null));

  for (let tamano = 1; tamano <= MAX_FACTURAS_EN_COMBO - 1; tamano++) {
    for (const grupo of combinaciones(otras, tamano)) {
      const suma = monto + grupo.reduce((acc, o) => acc + o.monto, 0);
      const match = pendientes.find(m => Math.abs(Math.abs(Number(m.importe)) - suma) <= TOLERANCIA_COMBO);
      if (!match) continue;
      const otrasTexto = grupo.map(o => `la factura ${o.numero} (${o.monto.toFixed(2)}€)`).join(' + ');
      return {
        tipo: 'combo_sugerido', numero, facturaId, facturaConcepto: concepto,
        movimientoId: match.id,
        otrasFacturas: grupo.map(o => ({ id: o.id, numero: o.numero })),
        detalle: `Esta factura (${monto.toFixed(2)}€) + ${otrasTexto} suman ${suma.toFixed(2)}€, cerca del importe de una línea pendiente (${Math.abs(Number(match.importe)).toFixed(2)}€) — confirma si es correcto.`,
      };
    }
  }

  return { tipo: 'sin_match', numero, facturaId, detalle: `Importe (${monto.toFixed(2)}€) no coincide con ninguna línea pendiente, ni sola ni combinada. Revisa a mano.` };
}

// Todas las combinaciones de `tamano` elementos de `arr`, sin repetir ni
// importar el orden -- para probar tríos/cuartetos de facturas sin generar
// más código del necesario para algo tan acotado (MAX_FACTURAS_EN_COMBO).
function combinaciones(arr, tamano) {
  if (tamano === 0) return [[]];
  if (arr.length < tamano) return [];
  const [primero, ...resto] = arr;
  const conPrimero = combinaciones(resto, tamano - 1).map(c => [primero, ...c]);
  const sinPrimero = combinaciones(resto, tamano);
  return [...conPrimero, ...sinPrimero];
}

// Guarda una factura recién subida (flujo principal, no lote). `hoja`/`clave`
// son opcionales: si aún no existe el excel del banco (o no se sabe el
// proveedor), se sube sin asignar y se reintentará el match automáticamente
// cuando haya movimientos. No pertenece a ningún trimestre.
async function procesarFacturaSubida({ hoja, clave, rutaBlob, nombreOriginal, concepto, analisis, subidoPor, proyectoId }) {
  const proveedorClave = hoja && clave ? `${hoja}::${clave}` : null;
  const numero = await siguienteNumero();

  const insert = await query(
    `INSERT INTO facturas (proveedor_clave, ruta_blob, nombre_original, numero,
                            importes, totales, fechas, es_imagen, concepto, estado, subido_por, proyecto_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'sin_match',$10,$11)
     RETURNING *`,
    [
      proveedorClave, rutaBlob, nombreOriginal, numero,
      analisis.importes, analisis.totales, analisis.fechas.map(f => f.toISOString().slice(0, 10)),
      analisis.esImagen, concepto || null, subidoPor || null, proyectoId || null,
    ]
  );
  const factura = { ...insert.rows[0], textoMayus: analisis.textoMayus };

  const resultado = await intentarMatch(factura);
  await aplicarEstado(factura.id, resultado);
  return resultado;
}

// Se llama tras importar/actualizar un excel del banco: reintenta el match de
// todas las facturas del flujo principal que se quedaron sin resolver
// (incluidas las subidas sueltas, sin proveedor, antes de que existiera el excel).
async function reintentarPendientes() {
  const { rows: pendientes } = await query(
    `SELECT * FROM facturas WHERE trimestre_id IS NULL AND estado IN ('sin_match', 'revisar') AND es_imagen = false`
  );
  let resueltas = 0;
  for (const factura of pendientes) {
    const resultado = await intentarMatch(factura);
    await aplicarEstado(factura.id, resultado);
    if (resultado.tipo === 'match_directo') resueltas++;
  }
  return { revisadas: pendientes.length, resueltas };
}

// A diferencia de reintentarPendientes (que solo reintenta el match con lo ya
// guardado), esto vuelve a descargar y leer el PDF de una factura sin
// resolver -- para cuando se corrige el regex de lectura o un bug de
// matching y se quedó mal por eso, no por falta de movimientos. Una factura
// a la vez (no todas de golpe) para que la pantalla pueda mostrar progreso
// real en vez de un único POST largo y ciego.
async function reprocesarFactura(facturaId) {
  const { rows: previas } = await query(`SELECT ruta_blob, nombre_original FROM facturas WHERE id = $1`, [facturaId]);
  if (previas.length === 0) throw new Error('Factura no encontrada.');
  const { ruta_blob: rutaBlob, nombre_original: nombreOriginal } = previas[0];
  const esPdf = /\.pdf$/i.test(nombreOriginal || '');

  const buffer = await descargarBlob(rutaBlob);
  const analisis = await analizarBuffer(buffer, esPdf);

  const { rows } = await query(
    `UPDATE facturas SET importes = $1, totales = $2, fechas = $3
     WHERE id = $4 RETURNING *`,
    [analisis.importes, analisis.totales, analisis.fechas.map(d => d.toISOString().slice(0, 10)), facturaId]
  );
  const factura = { ...rows[0], textoMayus: analisis.textoMayus };
  const resultado = await intentarMatch(factura);
  await aplicarEstado(factura.id, resultado);
  return resultado;
}

// Como reprocesarFactura, pero como último recurso: en vez del regex, le pasa
// el PDF/imagen tal cual a un modelo de IA para que lea el importe, la fecha
// y el proveedor. Deliberadamente NO se llama automáticamente desde
// reprocesarFactura ni al subir — tiene coste (aunque pequeño), así que es un
// botón aparte que la usuaria activa a mano, después de haber probado ya el
// recálculo normal (gratis) y seguir sin importe.
async function reprocesarFacturaConIA(facturaId) {
  const { rows: previas } = await query(`SELECT ruta_blob, nombre_original FROM facturas WHERE id = $1`, [facturaId]);
  if (previas.length === 0) throw new Error('Factura no encontrada.');
  const { ruta_blob: rutaBlob, nombre_original: nombreOriginal } = previas[0];
  const esPdf = /\.pdf$/i.test(nombreOriginal || '');

  const buffer = await descargarBlob(rutaBlob);
  const ia = await leerFacturaConIA(buffer, esPdf, nombreOriginal);

  const analisis = ia.ok
    ? {
        importes: [ia.importe],
        totales: [ia.importe],
        fechas: ia.fecha ? [new Date(ia.fecha)] : [],
        textoMayus: `IA: leída${ia.proveedor ? ` — proveedor: ${ia.proveedor}` : ''}.`,
      }
    : { importes: [], totales: [], fechas: [], textoMayus: `IA: no se ha podido leer (${ia.error})` };

  const { rows } = await query(
    `UPDATE facturas SET importes = $1, totales = $2, fechas = $3
     WHERE id = $4 RETURNING *`,
    [analisis.importes, analisis.totales, analisis.fechas.map(d => d.toISOString().slice(0, 10)), facturaId]
  );
  const factura = { ...rows[0], textoMayus: analisis.textoMayus };
  const resultado = await intentarMatch(factura);
  await aplicarEstado(factura.id, resultado);
  return resultado;
}

// Ids de las facturas del flujo principal a las que aplica reprocesarFactura
// -- para que la pantalla sepa qué lista recorrer, una a una, con progreso.
async function listarFacturasSinResolver() {
  const { rows } = await query(
    `SELECT id FROM facturas WHERE trimestre_id IS NULL AND estado IN ('sin_match', 'revisar') AND es_imagen = false`
  );
  return rows.map(r => r.id);
}

// Facturas a las que de verdad les haría falta la IA: sin ningún importe
// reconocido todavía (sea imagen o PDF ilegible) — a diferencia de
// listarFacturasSinResolver, esta SÍ incluye las imágenes (para eso es la
// IA) y excluye las que ya tienen importe pero no encajan con ningún
// movimiento (ahí la IA no puede ayudar, el dato ya se sabe).
async function listarFacturasSinImporte() {
  const { rows } = await query(
    `SELECT id FROM facturas
     WHERE trimestre_id IS NULL AND estado != 'matcheada'
       AND (totales IS NULL OR array_length(totales, 1) IS NULL)
       AND (importes IS NULL OR array_length(importes, 1) IS NULL)`
  );
  return rows.map(r => r.id);
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
  const resultado = await intentarMatch(factura);
  await aplicarEstado(factura.id, resultado);
  return resultado;
}

// ALTER TABLE ... ADD COLUMN IF NOT EXISTS es barato e idempotente en
// Postgres -- se ejecuta como mucho una vez por arranque en frío de la
// función serverless (el flag evita repetirlo en cada llamada dentro de la
// misma instancia), sin depender de correr una migración a mano en producción.
let columnasMotivoAseguradas = false;
async function asegurarColumnasMotivo() {
  if (columnasMotivoAseguradas) return;
  await query(`ALTER TABLE facturas ADD COLUMN IF NOT EXISTS motivo_tipo TEXT`);
  await query(`ALTER TABLE facturas ADD COLUMN IF NOT EXISTS motivo_detalle TEXT`);
  await query(`ALTER TABLE facturas ADD COLUMN IF NOT EXISTS motivo_candidatos JSONB`);
  columnasMotivoAseguradas = true;
}

// Como confirmarImporteManual, pero fija tambien la fecha de la factura --
// la fecha es la que desempata automaticamente cuando hay varias lineas
// pendientes con el mismo importe (ej. una cuota mensual).
async function confirmarDatosManual(facturaId, { importe, fecha, concepto }) {
  const { rows } = await query(
    `UPDATE facturas SET
       importes = CASE WHEN $2::numeric IS NOT NULL THEN ARRAY[$2::numeric] ELSE importes END,
       totales = CASE WHEN $2::numeric IS NOT NULL THEN ARRAY[$2::numeric] ELSE totales END,
       fechas = CASE WHEN $3::date IS NOT NULL THEN ARRAY[$3::date] ELSE fechas END,
       concepto = COALESCE($4, concepto)
     WHERE id = $1 RETURNING *`,
    [facturaId, importe ?? null, fecha ?? null, concepto ?? null]
  );
  if (rows.length === 0) throw new Error('Factura no encontrada.');

  const factura = rows[0];
  const resultado = await intentarMatch(factura);
  await aplicarEstado(factura.id, resultado);
  return resultado;
}

// Los candidatos de un caso "ambiguo"/"combo_sugerido" se guardan tal cual
// (no solo el texto del motivo) -- si no, se pierden en cuanto termina esta
// llamada y la pantalla no tiene con qué pintar los botones para elegir cuál
// es, aunque reintentarPendientes (subida de excel, "Recalcular") ya los haya
// calculado. Mismo problema/solución que datos_originales.larpmanager_candidatos.
function candidatosParaGuardar(resultado) {
  if (resultado.tipo === 'ambiguo') return { candidatos: resultado.candidatos };
  if (resultado.tipo === 'combo_sugerido') {
    return {
      movimientoId: resultado.movimientoId,
      otrasFacturas: resultado.otrasFacturas,
      detalle: resultado.detalle,
    };
  }
  return null;
}

async function aplicarEstado(facturaId, resultado) {
  await asegurarColumnasMotivo();
  const estado = resultado.tipo === 'match_directo' ? 'matcheada'
    : resultado.tipo === 'sin_movimientos' ? 'sin_match'
    : 'revisar';
  const candidatos = candidatosParaGuardar(resultado);
  await query(
    `UPDATE facturas SET estado = $2, motivo_tipo = $3, motivo_detalle = $4, motivo_candidatos = $5 WHERE id = $1 AND estado != 'matcheada'`,
    [facturaId, estado, resultado.tipo, resultado.detalle || null, candidatos ? JSON.stringify(candidatos) : null]
  );
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

module.exports = {
  procesarFacturaSubida, confirmarMatch, confirmarImporteManual, confirmarDatosManual, reintentarPendientes,
  reprocesarFactura, reprocesarFacturaConIA, listarFacturasSinResolver, listarFacturasSinImporte,
  siguienteNumero, asegurarColumnasMotivo,
};
