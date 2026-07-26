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

async function movimientosPendientes(trimestreId, hoja, clave) {
  const { rows } = await query(
    `SELECT id, importe, fecha, concepto FROM movimientos
     WHERE trimestre_id = $1 AND hoja = $2 AND clave = $3
       AND estado IN ('sin_resolver', 'pedida_pendiente')`,
    [trimestreId, hoja, clave]
  );
  return rows;
}

async function facturasSinResolver(trimestreId, proveedorClave, excluirId) {
  const { rows } = await query(
    `SELECT id, numero, totales, importes, fechas FROM facturas
     WHERE trimestre_id = $1 AND proveedor_clave = $2 AND estado IN ('sin_match', 'revisar') AND id != $3`,
    [trimestreId, proveedorClave, excluirId]
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

// Procesa una factura recién subida: la guarda, y la intenta matchear contra
// las líneas pendientes de ese proveedor en este trimestre. Nunca resuelve
// nada ambiguo sola — solo lo señala para que la usuaria lo confirme.
async function procesarFacturaSubida({ trimestreId, hoja, clave, rutaBlob, nombreOriginal, analisis }) {
  const proveedorClave = `${hoja}::${clave}`;
  const numero = await siguienteNumero(trimestreId);

  const insert = await query(
    `INSERT INTO facturas (trimestre_id, proveedor_clave, ruta_blob, nombre_original, numero,
                            importes, totales, fechas, es_imagen, estado)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'sin_match')
     RETURNING id`,
    [
      trimestreId, proveedorClave, rutaBlob, nombreOriginal, numero,
      analisis.importes, analisis.totales, analisis.fechas.map(f => f.toISOString().slice(0, 10)),
      analisis.esImagen,
    ]
  );
  const facturaId = insert.rows[0].id;

  if (analisis.esImagen) {
    await query(`UPDATE facturas SET estado = 'revisar' WHERE id = $1`, [facturaId]);
    return { tipo: 'imagen_sin_texto', numero, facturaId, detalle: 'Es una imagen — no se puede leer el importe automáticamente, revisa a mano.' };
  }

  const monto = montoCaracteristico(analisis.totales, analisis.importes);
  if (monto === null) {
    await query(`UPDATE facturas SET estado = 'revisar' WHERE id = $1`, [facturaId]);
    return { tipo: 'sin_importe', numero, facturaId, detalle: 'No se ha reconocido ningún importe en el archivo. Revisa a mano.' };
  }

  const pendientes = await movimientosPendientes(trimestreId, hoja, clave);
  const usaTotal = analisis.totales.includes(monto);

  const candidatos = pendientes
    .filter(m => Math.abs(Number(m.importe) - monto) <= TOLERANCIA)
    .map(m => ({ ...m, dias: diasEntre(m.fecha, analisis.fechas[0]) }))
    .sort((a, b) => (a.dias ?? 9999) - (b.dias ?? 9999));

  if (candidatos.length === 1 || (candidatos.length > 1 && candidatos[0].dias !== null && candidatos[0].dias < (candidatos[1]?.dias ?? 9999))) {
    const movimiento = candidatos[0];
    await resolverMovimiento(movimiento.id, String(numero), [facturaId]);
    await query(`UPDATE facturas SET estado = 'matcheada' WHERE id = $1`, [facturaId]);
    return {
      tipo: 'match_directo', numero, facturaId, movimientoId: movimiento.id,
      detalle: usaTotal
        ? `Importe reconocido como total (${monto.toFixed(2)}€) — coincide con una única línea pendiente.`
        : `Importe (${monto.toFixed(2)}€) coincide, pero no aparece junto a la palabra "Total" en el PDF — verifícalo.`,
    };
  }

  if (candidatos.length > 1) {
    await query(`UPDATE facturas SET estado = 'revisar' WHERE id = $1`, [facturaId]);
    return {
      tipo: 'ambiguo', numero, facturaId,
      candidatos: candidatos.map(c => ({ movimientoId: c.id, concepto: c.concepto, importe: c.importe, fecha: c.fecha })),
      detalle: `${candidatos.length} líneas pendientes de este proveedor tienen el mismo importe (${monto.toFixed(2)}€) — elige a cuál corresponde.`,
    };
  }

  // Sin match directo: probar combinación con otra factura de este proveedor ya subida.
  const otras = await facturasSinResolver(trimestreId, proveedorClave, facturaId);
  for (const otra of otras) {
    const montoOtra = montoCaracteristico(otra.totales, otra.importes);
    if (montoOtra === null) continue;
    const suma = monto + montoOtra;
    const match = pendientes.find(m => Math.abs(Number(m.importe) - suma) <= TOLERANCIA_COMBO);
    if (match) {
      await query(`UPDATE facturas SET estado = 'revisar' WHERE id IN ($1, $2)`, [facturaId, otra.id]);
      return {
        tipo: 'combo_sugerido', numero, facturaId,
        movimientoId: match.id,
        otraFacturaNumero: otra.numero,
        otraFacturaId: otra.id,
        detalle: `Esta factura (${monto.toFixed(2)}€) + la factura ${otra.numero} (${montoOtra.toFixed(2)}€) suman ${suma.toFixed(2)}€, el importe de una línea pendiente — confirma si es correcto.`,
      };
    }
  }

  await query(`UPDATE facturas SET estado = 'revisar' WHERE id = $1`, [facturaId]);
  return { tipo: 'sin_match', numero, facturaId, detalle: `Importe (${monto.toFixed(2)}€) no coincide con ninguna línea pendiente de este proveedor, ni sola ni combinada. Revisa a mano.` };
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

module.exports = { procesarFacturaSubida, confirmarMatch };
