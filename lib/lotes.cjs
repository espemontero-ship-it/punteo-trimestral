const { query } = require('./db.cjs');
const { siguienteNumero } = require('./facturaMatcher.cjs');

async function crearLote(trimestreId, colaboradorId, proyectoId) {
  await query(`INSERT INTO trimestres (id) VALUES ($1) ON CONFLICT DO NOTHING`, [trimestreId]);
  const { rows: proyectoRows } = await query(`SELECT nombre FROM proyectos WHERE id = $1`, [proyectoId]);
  if (!proyectoRows[0]) throw Object.assign(new Error('Proyecto no encontrado.'), { status: 404 });
  const { rows } = await query(
    `INSERT INTO lotes (trimestre_id, colaborador_id, evento, proyecto_id) VALUES ($1, $2, $3, $4) RETURNING id`,
    [trimestreId, colaboradorId, proyectoRows[0].nombre, proyectoId]
  );
  return rows[0].id;
}

// Reutiliza el lote de este colaborador+proyecto en el trimestre actual si ya
// existe (ej. subió una factura de NOL a nombre propio para un proyecto en el
// que también tiene lote); si no existe, lo crea igual que al darlo de alta.
async function buscarOCrearLote(colaboradorId, proyectoId) {
  const trimestreId = trimestreActual();
  const { rows } = await query(
    `SELECT id FROM lotes WHERE colaborador_id = $1 AND proyecto_id = $2 AND trimestre_id = $3`,
    [colaboradorId, proyectoId, trimestreId]
  );
  if (rows[0]) return rows[0].id;
  return crearLote(trimestreId, colaboradorId, proyectoId);
}

function trimestreActual() {
  const ahora = new Date();
  const trimestre = Math.floor(ahora.getUTCMonth() / 3) + 1;
  return `${ahora.getUTCFullYear()}-Q${trimestre}`;
}

async function listarLotesPorTrimestre(trimestreId) {
  const { rows } = await query(
    `SELECT l.id, p.nombre AS evento, l.proyecto_id, l.estado, l.creado_en, c.id AS colaborador_id, c.nombre AS colaborador_nombre,
            COALESCE(SUM(f.importe_declarado), 0) AS total_subido,
            COALESCE(SUM(f.importe_declarado) FILTER (WHERE f.estado_revision = 'aceptada'), 0) AS total_aceptado
     FROM lotes l
     JOIN colaboradores c ON c.id = l.colaborador_id
     JOIN proyectos p ON p.id = l.proyecto_id
     LEFT JOIN facturas f ON f.lote_id = l.id
     WHERE l.trimestre_id = $1
     GROUP BY l.id, c.id, p.nombre
     ORDER BY l.creado_en DESC`,
    [trimestreId]
  );
  return rows;
}

// Desde que el alta ya no asigna proyecto (el colaborador elige al subir,
// ver buscarOCrearLote), alguien puede no tener ningún lote todavía -- por
// eso arranca desde colaboradores con LEFT JOIN a lotes, no al revés, para
// que siga apareciendo en la lista de administración aunque no haya subido
// nada. Quien está en varios proyectos sigue apareciendo una fila por lote.
async function listarTodosLosLotes() {
  const { rows } = await query(
    `SELECT l.id, p.nombre AS evento, l.proyecto_id, l.estado, l.trimestre_id, l.creado_en,
            c.id AS colaborador_id, c.nombre AS colaborador_nombre, c.usuario AS colaborador_usuario,
            c.estado AS colaborador_estado, c.puede_invitar AS colaborador_puede_invitar,
            c.puede_subir_facturas_generales AS colaborador_puede_subir_facturas_generales,
            COALESCE(SUM(f.importe_declarado) FILTER (WHERE f.estado_revision IS DISTINCT FROM 'borrada'), 0) AS total_subido,
            COALESCE(SUM(f.importe_declarado) FILTER (WHERE f.estado_revision IN ('aceptada','cerrada')), 0) AS total_aceptado
     FROM colaboradores c
     LEFT JOIN lotes l ON l.colaborador_id = c.id
     LEFT JOIN proyectos p ON p.id = l.proyecto_id
     LEFT JOIN facturas f ON f.lote_id = l.id
     WHERE c.rol = 'colaborador'
     GROUP BY c.id, l.id, p.nombre
     ORDER BY l.creado_en DESC NULLS LAST, c.nombre`
  );
  return rows;
}

async function listarLotesPorColaborador(colaboradorId) {
  const { rows } = await query(
    `SELECT l.id, p.nombre AS evento, l.proyecto_id, l.estado, l.trimestre_id, l.creado_en,
            COALESCE(SUM(f.importe_declarado), 0) AS total_subido
     FROM lotes l
     JOIN proyectos p ON p.id = l.proyecto_id
     LEFT JOIN facturas f ON f.lote_id = l.id
     WHERE l.colaborador_id = $1
     GROUP BY l.id, p.nombre
     ORDER BY l.creado_en DESC`,
    [colaboradorId]
  );
  return rows;
}

async function obtenerLote(loteId) {
  const { rows } = await query(
    `SELECT l.id, p.nombre AS evento, l.proyecto_id, l.estado, l.trimestre_id, l.creado_en, c.id AS colaborador_id, c.nombre AS colaborador_nombre
     FROM lotes l
     JOIN colaboradores c ON c.id = l.colaborador_id
     JOIN proyectos p ON p.id = l.proyecto_id
     WHERE l.id = $1`,
    [loteId]
  );
  return rows[0] || null;
}

async function listarFacturasDeLote(loteId) {
  const { rows } = await query(
    `SELECT id, numero, nombre_original, ruta_blob, concepto, importe_declarado, fechas, estado_revision, motivo_rechazo, fecha_cierre, es_imagen, creado_en
     FROM facturas WHERE lote_id = $1 AND estado_revision IS DISTINCT FROM 'borrada' ORDER BY creado_en`,
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

async function actualizarFactura(facturaId, { concepto, importe, fecha, estadoRevision, motivoRechazo, fechaCierre }) {
  const { rows } = await query(`SELECT estado_revision FROM facturas WHERE id = $1`, [facturaId]);
  if (!rows[0]) throw Object.assign(new Error('Factura no encontrada.'), { status: 404 });
  if (rows[0].estado_revision === 'cerrada') {
    throw Object.assign(new Error('Esta factura ya está cerrada, no se puede editar.'), { status: 409 });
  }
  if (estadoRevision === 'cerrada' && !fechaCierre) {
    throw Object.assign(new Error('Falta la fecha de cierre.'), { status: 400 });
  }

  await query(
    `UPDATE facturas SET
       concepto = COALESCE($2, concepto),
       importe_declarado = COALESCE($3, importe_declarado),
       fechas = CASE WHEN $4::date IS NOT NULL THEN ARRAY[$4::date] ELSE fechas END,
       estado_revision = COALESCE($5, estado_revision),
       motivo_rechazo = $6,
       fecha_cierre = CASE WHEN $5 = 'cerrada' THEN $7::date ELSE fecha_cierre END
     WHERE id = $1`,
    [facturaId, concepto ?? null, importe ?? null, fecha ?? null, estadoRevision ?? null, motivoRechazo ?? null, fechaCierre ?? null]
  );
}

async function eliminarFactura(facturaId) {
  const { rows } = await query(`SELECT estado_revision FROM facturas WHERE id = $1`, [facturaId]);
  if (!rows[0]) throw Object.assign(new Error('Factura no encontrada.'), { status: 404 });
  if (rows[0].estado_revision === 'cerrada') {
    throw Object.assign(new Error('Esta factura ya está cerrada, no se puede borrar.'), { status: 409 });
  }
  await query(`UPDATE facturas SET estado_revision = 'borrada' WHERE id = $1`, [facturaId]);
}

async function calcularTotales(loteId) {
  const { rows: [f] } = await query(
    `SELECT
       COALESCE(SUM(importe_declarado) FILTER (WHERE estado_revision = 'subida'), 0) AS total_sin_revisar,
       COALESCE(SUM(importe_declarado) FILTER (WHERE estado_revision IN ('aceptada','cerrada')), 0) AS total_aceptado,
       COALESCE(SUM(importe_declarado) FILTER (WHERE estado_revision = 'aceptada'), 0) AS total_aceptado_pendiente_pago,
       COALESCE(SUM(importe_declarado) FILTER (WHERE estado_revision = 'rechazada'), 0) AS total_rechazado,
       COUNT(*) FILTER (WHERE estado_revision = 'subida') AS pendientes_revision
     FROM facturas WHERE lote_id = $1 AND estado_revision IS DISTINCT FROM 'borrada'`,
    [loteId]
  );
  const { rows: [p] } = await query(
    `SELECT COALESCE(SUM(importe), 0) AS total_pagado FROM pagos WHERE lote_id = $1`,
    [loteId]
  );
  const totalPagado = Number(p.total_pagado);
  const pendiente = Math.round((Number(f.total_aceptado_pendiente_pago) - totalPagado) * 100) / 100;
  return {
    totalSinRevisar: Number(f.total_sin_revisar),
    totalAceptado: Number(f.total_aceptado),
    totalRechazado: Number(f.total_rechazado),
    totalPagado,
    pendiente,
    pendientesRevision: Number(f.pendientes_revision),
  };
}

// Facturas de colaboradores (de cualquier lote de este proyecto) todavía sin
// cerrar del todo -- para la vista "pendientes de cierre" de la pestaña
// Proyectos, junto a devoluciones y facturas futuras de movimientos.
async function listarFacturasPendientesPorProyecto(proyectoId) {
  const { rows } = await query(
    `SELECT f.id, f.concepto, f.importe_declarado, f.estado_revision, f.creado_en, 'colaborador' AS pagado_por,
            l.id AS lote_id, c.nombre AS colaborador_nombre
     FROM facturas f
     JOIN lotes l ON l.id = f.lote_id
     JOIN colaboradores c ON c.id = l.colaborador_id
     WHERE l.proyecto_id = $1 AND f.estado_revision IN ('subida', 'aceptada')
     UNION ALL
     SELECT f.id, f.concepto, COALESCE(f.importe_declarado, f.totales[1]) AS importe_declarado, f.estado_revision, f.creado_en, 'nol' AS pagado_por,
            NULL AS lote_id, c.nombre AS colaborador_nombre
     FROM facturas f
     LEFT JOIN colaboradores c ON c.id = f.subido_por
     WHERE f.lote_id IS NULL AND f.proyecto_id = $1 AND f.estado NOT IN ('matcheada')
     ORDER BY colaborador_nombre, creado_en`,
    [proyectoId]
  );
  return rows;
}

module.exports = {
  crearLote, buscarOCrearLote, trimestreActual, listarLotesPorTrimestre, listarTodosLosLotes, listarLotesPorColaborador, obtenerLote,
  listarFacturasDeLote, subirFacturaLote, actualizarFactura, eliminarFactura, calcularTotales, listarFacturasPendientesPorProyecto,
};
