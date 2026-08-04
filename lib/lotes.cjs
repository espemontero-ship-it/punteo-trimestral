const { query } = require('./db.cjs');
const { siguienteNumero } = require('./facturaMatcher.cjs');
const { crearColaborador } = require('./colaboradores.cjs');

async function crearLote(trimestreId, colaboradorId, evento) {
  await query(`INSERT INTO trimestres (id) VALUES ($1) ON CONFLICT DO NOTHING`, [trimestreId]);
  const { rows } = await query(
    `INSERT INTO lotes (trimestre_id, colaborador_id, evento) VALUES ($1, $2, $3) RETURNING id`,
    [trimestreId, colaboradorId, evento]
  );
  return rows[0].id;
}

function trimestreActual() {
  const ahora = new Date();
  const trimestre = Math.floor(ahora.getUTCMonth() / 3) + 1;
  return `${ahora.getUTCFullYear()}-Q${trimestre}`;
}

// Fila de alta única de la tabla de Colaboradores: crea el colaborador si su
// usuario/correo todavía no existe, o reutiliza el que ya hay -- así añadir un
// segundo proyecto a alguien que ya existe es escribir el mismo formulario de
// siempre con un proyecto distinto, sin duplicar la persona ni pedirle otra
// contraseña.
async function crearColaboradorYLote(nombre, usuario, proyecto) {
  const { rows: existentes } = await query(
    `SELECT id, nombre, usuario, estado FROM colaboradores WHERE usuario = $1`,
    [usuario]
  );

  let colaborador;
  let password = null;
  if (existentes.length > 0) {
    colaborador = existentes[0];
  } else {
    try {
      const creado = await crearColaborador(nombre, usuario);
      colaborador = { id: creado.id, nombre: creado.nombre, usuario: creado.usuario, estado: 'activo' };
      password = creado.password;
    } catch (err) {
      if (err.code === '23505') {
        // Carrera: otra petición lo creó justo antes -- reusar el que ya existe.
        const { rows } = await query(`SELECT id, nombre, usuario, estado FROM colaboradores WHERE usuario = $1`, [usuario]);
        colaborador = rows[0];
      } else {
        throw err;
      }
    }
  }

  const loteId = await crearLote(trimestreActual(), colaborador.id, proyecto);
  return { colaborador, loteId, password };
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
    `SELECT l.id, l.evento, l.estado, l.trimestre_id, l.creado_en,
            c.id AS colaborador_id, c.nombre AS colaborador_nombre, c.usuario AS colaborador_usuario,
            c.estado AS colaborador_estado,
            COALESCE(SUM(f.importe_declarado) FILTER (WHERE f.estado_revision IS DISTINCT FROM 'borrada'), 0) AS total_subido,
            COALESCE(SUM(f.importe_declarado) FILTER (WHERE f.estado_revision IN ('aceptada','cerrada')), 0) AS total_aceptado
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

module.exports = {
  crearLote, crearColaboradorYLote, listarLotesPorTrimestre, listarTodosLosLotes, listarLotesPorColaborador, obtenerLote,
  listarFacturasDeLote, subirFacturaLote, actualizarFactura, eliminarFactura, calcularTotales,
};
