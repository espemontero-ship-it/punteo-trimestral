const { query } = require('./db.cjs');
const { registrarNota } = require('./memoria.cjs');

async function crearPago(loteId, importe, fecha, nota) {
  const { rows } = await query(
    `INSERT INTO pagos (lote_id, importe, fecha, nota) VALUES ($1, $2, $3, $4) RETURNING id`,
    [loteId, importe, fecha || null, nota || null]
  );
  return rows[0].id;
}

async function listarPagosDeLote(loteId) {
  const { rows } = await query(
    `SELECT p.id, p.importe, p.fecha, p.nota, p.movimiento_id, p.creado_en,
            m.concepto AS movimiento_concepto, m.hoja AS movimiento_hoja,
            COALESCE(array_agg(pf.factura_id) FILTER (WHERE pf.factura_id IS NOT NULL), '{}') AS factura_ids
     FROM pagos p
     LEFT JOIN movimientos m ON m.id = p.movimiento_id
     LEFT JOIN pago_facturas pf ON pf.pago_id = p.id
     WHERE p.lote_id = $1
     GROUP BY p.id, m.concepto, m.hoja
     ORDER BY p.creado_en`,
    [loteId]
  );
  return rows;
}

async function asociarFacturas(pagoId, facturaIds) {
  await query(`DELETE FROM pago_facturas WHERE pago_id = $1`, [pagoId]);
  for (const facturaId of facturaIds) {
    await query(
      `INSERT INTO pago_facturas (pago_id, factura_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [pagoId, facturaId]
    );
  }
}

async function vincularMovimiento(pagoId, movimientoId) {
  const { rows: pagoRows } = await query(
    `SELECT p.lote_id, l.evento, c.nombre AS colaborador_nombre
     FROM pagos p JOIN lotes l ON l.id = p.lote_id JOIN colaboradores c ON c.id = l.colaborador_id
     WHERE p.id = $1`,
    [pagoId]
  );
  if (pagoRows.length === 0) throw new Error('Pago no encontrado');
  const { lote_id, evento, colaborador_nombre } = pagoRows[0];

  const { rows: facturaRows } = await query(
    `SELECT f.id, f.numero FROM pago_facturas pf JOIN facturas f ON f.id = pf.factura_id WHERE pf.pago_id = $1 ORDER BY f.numero`,
    [pagoId]
  );

  const nota = `${colaborador_nombre} - ${evento}`;

  await query(`UPDATE pagos SET movimiento_id = $1 WHERE id = $2`, [movimientoId, pagoId]);

  for (const f of facturaRows) {
    await query(
      `INSERT INTO movimiento_facturas (movimiento_id, factura_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [movimientoId, f.id]
    );
  }

  const { rows } = await query(
    `UPDATE movimientos SET estado = 'resuelta', nota_final = $1 WHERE id = $2 RETURNING hoja, clave`,
    [nota, movimientoId]
  );
  if (rows.length) await registrarNota(rows[0].hoja, rows[0].clave, nota);
}

module.exports = { crearPago, listarPagosDeLote, asociarFacturas, vincularMovimiento };
