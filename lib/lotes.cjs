const { query } = require('./db.cjs');
const { siguienteNumero } = require('./facturaMatcher.cjs');

async function crearLote(trimestreId, colaboradorId, evento) {
  await query(`INSERT INTO trimestres (id) VALUES ($1) ON CONFLICT DO NOTHING`, [trimestreId]);
  const { rows } = await query(
    `INSERT INTO lotes (trimestre_id, colaborador_id, evento) VALUES ($1, $2, $3) RETURNING id`,
    [trimestreId, colaboradorId, evento]
  );
  return rows[0].id;
}

async function listarLotesPorTrimestre(trimestreId) {
  const { rows } = await query(
    `SELECT l.id, l.evento, l.estado, l.creado_en, c.id AS colaborador_id, c.nombre AS colaborador_nombre,
            COALESCE(SUM(f.importe_declarado), 0) AS total_subido,
            COALESCE(SUM(f.importe_declarado) FILTER (WHERE f.estado_revision = 'aceptada'), 0) AS total_aceptado
     FROM lotes l
     JOIN colaboradores c ON c.id = l.colaborador_id
     LEFT JOIN facturas f ON f.lote_id = l.id
     WHERE l.trimestre_id = $1
     GROUP BY l.id, c.id
     ORDER BY l.creado_en DESC`,
    [trimestreId]
  );
  return rows;
}

// El resto de la app ya no tiene un "trimestre actual" (ver PROYECTO.md,
// modelo continuo) -- colaboradores sigue teniendo trimestre por lote (se
// rediseña aparte), así que la pantalla general los lista todos juntos, con
// su trimestre visible en cada tarjeta.
async function listarTodosLosLotes() {
  const { rows } = await query(
    `SELECT l.id, l.evento, l.estado, l.trimestre_id, l.creado_en, c.id AS colaborador_id, c.nombre AS colaborador_nombre,
            COALESCE(SUM(f.importe_declarado), 0) AS total_subido,
            COALESCE(SUM(f.importe_declarado) FILTER (WHERE f.estado_revision = 'aceptada'), 0) AS total_aceptado
     FROM lotes l
     JOIN colaboradores c ON c.id = l.colaborador_id
     LEFT JOIN facturas f ON f.lote_id = l.id
     GROUP BY l.id, c.id
     ORDER BY l.creado_en DESC`
  );
  return rows;
}

async function listarLotesPorColaborador(colaboradorId) {
  const { rows } = await query(
    `SELECT l.id, l.evento, l.estado, l.trimestre_id, l.creado_en,
            COALESCE(SUM(f.importe_declarado), 0) AS total_subido
     FROM lotes l
     LEFT JOIN facturas f ON f.lote_id = l.id
     WHERE l.colaborador_id = $1
     GROUP BY l.id
     ORDER BY l.creado_en DESC`,
    [colaboradorId]
  );
  return rows;
}

async function obtenerLote(loteId) {
  const { rows } = await query(
    `SELECT l.id, l.evento, l.estado, l.trimestre_id, l.creado_en, c.id AS colaborador_id, c.nombre AS colaborador_nombre
     FROM lotes l JOIN colaboradores c ON c.id = l.colaborador_id
     WHERE l.id = $1`,
    [loteId]
  );
  return rows[0] || null;
}

async function listarFacturasDeLote(loteId) {
  const { rows } = await query(
    `SELECT id, numero, nombre_original, ruta_blob, concepto, importe_declarado, fechas, estado_revision, motivo_rechazo, es_imagen, creado_en
     FROM facturas WHERE lote_id = $1 ORDER BY creado_en`,
    [loteId]
  );
  return rows;
}

async function subirFacturaLote({ loteId, trimestreId, rutaBlob, nombreOriginal, concepto, importe, fecha, esImagen }) {
  const numero = await siguienteNumero(trimestreId);
  const { rows } = await query(
    `INSERT INTO facturas (trimestre_id, lote_id, ruta_blob, nombre_original, numero, concepto,
                            importe_declarado, fechas, estado_revision, es_imagen, estado)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'subida',$9,'revisar')
     RETURNING id, numero`,
    [trimestreId, loteId, rutaBlob, nombreOriginal, numero, concepto || null, importe || null, fecha ? [fecha] : [], !!esImagen]
  );
  return rows[0];
}

async function actualizarFactura(facturaId, { concepto, importe, fecha, estadoRevision, motivoRechazo }) {
  await query(
    `UPDATE facturas SET
       concepto = COALESCE($2, concepto),
       importe_declarado = COALESCE($3, importe_declarado),
       fechas = CASE WHEN $4::date IS NOT NULL THEN ARRAY[$4::date] ELSE fechas END,
       estado_revision = COALESCE($5, estado_revision),
       motivo_rechazo = $6
     WHERE id = $1`,
    [facturaId, concepto ?? null, importe ?? null, fecha ?? null, estadoRevision ?? null, motivoRechazo ?? null]
  );
}

async function eliminarFactura(facturaId) {
  await query(`DELETE FROM facturas WHERE id = $1`, [facturaId]);
}

async function calcularTotales(loteId) {
  const { rows: [f] } = await query(
    `SELECT
       COALESCE(SUM(importe_declarado), 0) AS total_subido,
       COALESCE(SUM(importe_declarado) FILTER (WHERE estado_revision = 'aceptada'), 0) AS total_aceptado,
       COUNT(*) FILTER (WHERE estado_revision = 'subida') AS pendientes_revision
     FROM facturas WHERE lote_id = $1`,
    [loteId]
  );
  const { rows: [p] } = await query(
    `SELECT COALESCE(SUM(importe), 0) AS total_pagado FROM pagos WHERE lote_id = $1`,
    [loteId]
  );
  const totalAceptado = Number(f.total_aceptado);
  const totalPagado = Number(p.total_pagado);
  return {
    totalSubido: Number(f.total_subido),
    totalAceptado,
    pendientesRevision: Number(f.pendientes_revision),
    totalPagado,
    diferencia: Math.round((totalAceptado - totalPagado) * 100) / 100,
  };
}

module.exports = {
  crearLote, listarLotesPorTrimestre, listarTodosLosLotes, listarLotesPorColaborador, obtenerLote,
  listarFacturasDeLote, subirFacturaLote, actualizarFactura, eliminarFactura, calcularTotales,
};
