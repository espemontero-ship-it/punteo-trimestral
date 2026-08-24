const { query } = require('./db.cjs');
const { registrarNota } = require('./memoria.cjs');
const { importeDeFactura } = require('./importeFactura.cjs');
const { asegurarEsquemaReembolso } = require('./lotes.cjs');

async function crearAnticipo(loteId, { importe, fecha, esEfectivo }) {
  await asegurarEsquemaReembolso();
  const valor = Number(importe);
  if (!valor || valor <= 0) throw Object.assign(new Error('Falta el importe.'), { status: 400 });

  const { rows } = await query(
    `INSERT INTO pagos (lote_id, importe, fecha, es_efectivo) VALUES ($1, $2, $3, $4) RETURNING id`,
    [loteId, valor, fecha || null, !!esEfectivo]
  );
  return rows[0].id;
}

async function anticiposPendientes(loteId) {
  const { rows } = await query(
    `SELECT id, importe FROM pagos
     WHERE lote_id = $1 AND consumido_en_pago_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM facturas f WHERE f.pago_id = pagos.id)`,
    [loteId]
  );
  return rows;
}

async function pagarFacturas(loteId, { facturaIds, fecha }) {
  await asegurarEsquemaReembolso();
  if (!Array.isArray(facturaIds) || facturaIds.length === 0) {
    throw Object.assign(new Error('Elige al menos una factura.'), { status: 400 });
  }

  const { rows: facturas } = await query(
    `SELECT id, totales, estado_revision FROM facturas WHERE id = ANY($1::bigint[]) AND lote_id = $2`,
    [facturaIds, loteId]
  );
  if (facturas.length !== facturaIds.length) {
    throw Object.assign(new Error('Alguna factura no pertenece a esta carpeta.'), { status: 400 });
  }
  if (facturas.some(f => f.estado_revision !== 'aceptada')) {
    throw Object.assign(new Error('Solo se pueden pagar facturas aceptadas.'), { status: 409 });
  }

  const totalFacturas = facturas.reduce((acc, f) => acc + (importeDeFactura(f) || 0), 0);
  const anticipos = await anticiposPendientes(loteId);
  const totalAnticipos = anticipos.reduce((acc, a) => acc + Number(a.importe), 0);
  const total = Math.round((totalFacturas - totalAnticipos) * 100) / 100;

  const { rows: pagoRows } = await query(
    `INSERT INTO pagos (lote_id, importe, fecha) VALUES ($1, $2, $3) RETURNING id`,
    [loteId, total, fecha || null]
  );
  const pagoId = pagoRows[0].id;

  await query(
    `UPDATE facturas SET estado_revision = 'pagada', pago_id = $2 WHERE id = ANY($1::bigint[])`,
    [facturaIds, pagoId]
  );
  if (anticipos.length > 0) {
    await query(
      `UPDATE pagos SET consumido_en_pago_id = $2 WHERE id = ANY($1::bigint[])`,
      [anticipos.map(a => a.id), pagoId]
    );
  }

  return { id: pagoId, importe: total };
}

async function listarPagosDeLote(loteId) {
  await asegurarEsquemaReembolso();
  const { rows } = await query(
    `SELECT p.id, p.importe, p.fecha, p.es_efectivo, p.movimiento_id, p.creado_en,
            m.concepto AS movimiento_concepto, m.hoja AS movimiento_hoja,
            COALESCE(array_agg(f.numero) FILTER (WHERE f.id IS NOT NULL), '{}') AS facturas_numeros
     FROM pagos p
     LEFT JOIN movimientos m ON m.id = p.movimiento_id
     LEFT JOIN facturas f ON f.pago_id = p.id
     WHERE p.lote_id = $1
     GROUP BY p.id, m.concepto, m.hoja
     ORDER BY p.creado_en`,
    [loteId]
  );
  return rows;
}

async function pagosSinConciliar() {
  await asegurarEsquemaReembolso();
  const { rows } = await query(
    `SELECT p.id, p.importe, p.lote_id, l.proyecto_id, pr.nombre AS proyecto_nombre, c.nombre AS colaborador_nombre
     FROM pagos p
     JOIN lotes l ON l.id = p.lote_id
     JOIN proyectos pr ON pr.id = l.proyecto_id
     JOIN colaboradores c ON c.id = l.colaborador_id
     WHERE p.movimiento_id IS NULL AND p.es_efectivo = false`
  );
  return rows;
}

async function vincularPago(pagoId, movimientoId) {
  await asegurarEsquemaReembolso();
  const { rows: pagoRows } = await query(
    `SELECT p.lote_id, c.nombre AS colaborador_nombre, pr.nombre AS proyecto_nombre
     FROM pagos p JOIN lotes l ON l.id = p.lote_id
     JOIN colaboradores c ON c.id = l.colaborador_id JOIN proyectos pr ON pr.id = l.proyecto_id
     WHERE p.id = $1`,
    [pagoId]
  );
  if (pagoRows.length === 0) throw Object.assign(new Error('Pago no encontrado.'), { status: 404 });
  const { colaborador_nombre, proyecto_nombre } = pagoRows[0];

  const { rows: facturaRows } = await query(
    `SELECT id FROM facturas WHERE pago_id = $1`, [pagoId]
  );
  const esAnticipo = facturaRows.length === 0;
  const nota = esAnticipo
    ? `anticipo ${colaborador_nombre}`
    : `${colaborador_nombre} - ${proyecto_nombre}`;

  if (facturaRows.length > 0) {
    const { rows: yaColgadas } = await query(
      `SELECT factura_id, movimiento_id FROM movimiento_facturas
       WHERE factura_id = ANY($1::bigint[]) AND movimiento_id != $2`,
      [facturaRows.map(f => f.id), movimientoId]
    );
    if (yaColgadas.length > 0) {
      throw Object.assign(
        new Error(`La factura ${yaColgadas[0].factura_id} ya está enganchada al movimiento ${yaColgadas[0].movimiento_id}.`),
        { status: 409 }
      );
    }
  }

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

async function desvincularPago(pagoId) {
  await asegurarEsquemaReembolso();
  const { rows } = await query(`SELECT movimiento_id FROM pagos WHERE id = $1`, [pagoId]);
  if (rows.length === 0) throw Object.assign(new Error('Pago no encontrado.'), { status: 404 });
  const { movimiento_id } = rows[0];
  if (!movimiento_id) throw Object.assign(new Error('Ese pago no está vinculado a ninguna línea.'), { status: 409 });

  const { rows: facturaRows } = await query(`SELECT id FROM facturas WHERE pago_id = $1`, [pagoId]);

  await query(`UPDATE pagos SET movimiento_id = NULL WHERE id = $1`, [pagoId]);
  if (facturaRows.length > 0) {
    await query(
      `DELETE FROM movimiento_facturas WHERE movimiento_id = $1 AND factura_id = ANY($2::bigint[])`,
      [movimiento_id, facturaRows.map(f => f.id)]
    );
  }
  await query(`UPDATE movimientos SET estado = 'sin_resolver', nota_final = NULL WHERE id = $1`, [movimiento_id]);
  return { movimientoId: movimiento_id };
}

async function pagosParaEnvio(movimientoIds) {
  if (movimientoIds.length === 0) return [];
  const { rows: pagos } = await query(
    `SELECT p.id, p.importe, p.fecha, p.movimiento_id, c.nombre AS colaborador_nombre, pr.nombre AS proyecto_nombre
     FROM pagos p
     JOIN lotes l ON l.id = p.lote_id
     JOIN colaboradores c ON c.id = l.colaborador_id
     JOIN proyectos pr ON pr.id = l.proyecto_id
     WHERE p.movimiento_id = ANY($1::bigint[])
     ORDER BY p.id`,
    [movimientoIds]
  );
  if (pagos.length === 0) return [];

  const { rows: facturas } = await query(
    `SELECT pago_id, numero, concepto, totales FROM facturas WHERE pago_id = ANY($1::bigint[])`,
    [pagos.map(p => p.id)]
  );
  const { rows: anticipos } = await query(
    `SELECT consumido_en_pago_id, importe, fecha, es_efectivo FROM pagos
     WHERE consumido_en_pago_id = ANY($1::bigint[])`,
    [pagos.map(p => p.id)]
  );

  return pagos.map(p => ({
    ...p,
    facturas: facturas.filter(f => f.pago_id === p.id).map(f => ({
      numero: f.numero, concepto: f.concepto, importe: importeDeFactura(f),
    })),
    anticipos: anticipos.filter(a => a.consumido_en_pago_id === p.id),
  }));
}

module.exports = {
  crearAnticipo, anticiposPendientes, pagarFacturas, listarPagosDeLote,
  pagosSinConciliar, vincularPago, desvincularPago, pagosParaEnvio,
};
