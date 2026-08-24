const { query } = require('./db.cjs');
const crypto = require('crypto');
const { siguienteNumero, facturaConMismaHuella, asegurarColumnasMotivo } = require('./facturaMatcher.cjs');
const { descargarBlob, eliminarBlob } = require('./blob.cjs');
const { importeDeFactura } = require('./importeFactura.cjs');

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

async function importesPorLote(loteIds) {
  const ids = loteIds.filter(Boolean);
  if (ids.length === 0) return new Map();
  const { rows } = await query(
    `SELECT lote_id, totales, estado_revision FROM facturas WHERE lote_id = ANY($1::bigint[])`,
    [ids]
  );
  const mapa = new Map();
  for (const f of rows) {
    const clave = String(f.lote_id);
    if (!mapa.has(clave)) mapa.set(clave, []);
    mapa.get(clave).push({ importe: importeDeFactura(f) || 0, estado: f.estado_revision });
  }
  return mapa;
}

const sumarImportes = (lista, filtro) =>
  Math.round((lista || []).filter(filtro).reduce((a, f) => a + f.importe, 0) * 100) / 100;

async function listarLotesPorTrimestre(trimestreId) {
  const { rows } = await query(
    `SELECT l.id, p.nombre AS evento, l.proyecto_id, l.estado, l.creado_en,
            c.id AS colaborador_id, c.nombre AS colaborador_nombre
     FROM lotes l
     JOIN colaboradores c ON c.id = l.colaborador_id
     JOIN proyectos p ON p.id = l.proyecto_id
     WHERE l.trimestre_id = $1
     ORDER BY l.creado_en DESC`,
    [trimestreId]
  );
  const importes = await importesPorLote(rows.map(r => r.id));
  return rows.map(r => {
    const lista = importes.get(String(r.id));
    return {
      ...r,
      total_subido: sumarImportes(lista, () => true),
      total_aceptado: sumarImportes(lista, f => f.estado === 'aceptada'),
    };
  });
}

async function listarTodosLosLotes() {
  const { rows } = await query(
    `SELECT l.id, p.nombre AS evento, l.proyecto_id, l.estado, l.trimestre_id, l.creado_en,
            c.id AS colaborador_id, c.nombre AS colaborador_nombre, c.usuario AS colaborador_usuario,
            c.estado AS colaborador_estado, c.puede_invitar AS colaborador_puede_invitar,
            c.puede_subir_facturas_generales AS colaborador_puede_subir_facturas_generales
     FROM colaboradores c
     LEFT JOIN lotes l ON l.colaborador_id = c.id
     LEFT JOIN proyectos p ON p.id = l.proyecto_id
     WHERE c.rol = 'colaborador'
     ORDER BY l.creado_en DESC NULLS LAST, c.nombre`
  );
  const importes = await importesPorLote(rows.map(r => r.id));
  return rows.map(r => {
    const lista = importes.get(String(r.id));
    return {
      ...r,
      total_subido: sumarImportes(lista, f => f.estado !== 'borrada'),
      total_aceptado: sumarImportes(lista, f => f.estado === 'aceptada' || f.estado === 'cerrada'),
    };
  });
}

async function listarLotesPorColaborador(colaboradorId) {
  const { rows } = await query(
    `SELECT l.id, p.nombre AS evento, l.proyecto_id, l.estado, l.trimestre_id, l.creado_en
     FROM lotes l
     JOIN proyectos p ON p.id = l.proyecto_id
     WHERE l.colaborador_id = $1
     ORDER BY l.creado_en DESC`,
    [colaboradorId]
  );
  const importes = await importesPorLote(rows.map(r => r.id));
  return rows.map(r => ({ ...r, total_subido: sumarImportes(importes.get(String(r.id)), f => f.estado !== 'borrada') }));
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
  await asegurarColumnasMotivo();
  const { rows } = await query(
    `SELECT id, numero, nombre_original, ruta_blob, concepto, totales, proveedor, importe_a_mano,
            fechas, estado_revision, motivo_rechazo, fecha_cierre, es_imagen, creado_en
     FROM facturas WHERE lote_id = $1 AND estado_revision IS DISTINCT FROM 'borrada' ORDER BY creado_en`,
    [loteId]
  );
  return rows;
}

async function subirFacturaLote({ loteId, rutaBlob, nombreOriginal, concepto, analisis }) {
  const yaSubida = await facturaConMismaHuella(analisis.huella);
  if (yaSubida) {
    try { await eliminarBlob(rutaBlob); } catch {  }
    throw Object.assign(new Error('This file has already been uploaded. It has not been saved again.'), { status: 409 });
  }

  const numero = await siguienteNumero();
  const { rows } = await query(
    `INSERT INTO facturas (lote_id, ruta_blob, nombre_original, numero, concepto,
                            totales, fechas, proveedor, huella, estado_revision, estado)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'subida','revisar')
     RETURNING id, numero`,
    [loteId, rutaBlob, nombreOriginal, numero, concepto || null,
     analisis.totales || [], (analisis.fechas || []).map(f => f.toISOString().slice(0, 10)),
     analisis.proveedorIA || null, analisis.huella || null]
  );
  return { ...rows[0], motivoIA: analisis.motivoIA || null };
}

async function facturaSuyaSinRevisar(colaboradorId, facturaId) {
  const { rows } = await query(
    `SELECT f.id, f.ruta_blob, f.estado_revision, l.colaborador_id
     FROM facturas f JOIN lotes l ON l.id = f.lote_id WHERE f.id = $1`, [facturaId]
  );
  const f = rows[0];
  if (!f) throw Object.assign(new Error('Factura no encontrada.'), { status: 404 });
  if (String(f.colaborador_id) !== String(colaboradorId)) {
    throw Object.assign(new Error('Esa factura no es tuya.'), { status: 403 });
  }
  if (f.estado_revision !== 'subida') {
    throw Object.assign(new Error('Esta factura ya está revisada: pide el cambio a la administración.'), { status: 409 });
  }
  return f;
}

async function corregirFacturaColaborador(colaboradorId, facturaId, { concepto, importe, fecha }) {
  await facturaSuyaSinRevisar(colaboradorId, facturaId);
  await query(
    `UPDATE facturas SET
       concepto = COALESCE($2, concepto),
       totales = CASE WHEN $3::numeric IS NOT NULL THEN ARRAY[$3::numeric] ELSE totales END,
       importe_a_mano = CASE WHEN $3::numeric IS NOT NULL THEN true ELSE importe_a_mano END,
       fechas = CASE WHEN $4::date IS NOT NULL THEN ARRAY[$4::date] ELSE fechas END
     WHERE id = $1`,
    [facturaId, concepto ?? null, importe ?? null, fecha ?? null]
  );
}

async function retirarFacturaColaborador(colaboradorId, facturaId) {
  const f = await facturaSuyaSinRevisar(colaboradorId, facturaId);
  await query(`DELETE FROM facturas WHERE id = $1`, [facturaId]);
  try { await eliminarBlob(f.ruta_blob); } catch {  }
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
       totales = CASE WHEN $3::numeric IS NOT NULL THEN ARRAY[$3::numeric] ELSE totales END,
       importe_a_mano = CASE WHEN $3::numeric IS NOT NULL THEN true ELSE importe_a_mano END,
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
  const { rows: facturas } = await query(
    `SELECT totales, estado_revision FROM facturas
     WHERE lote_id = $1 AND estado_revision IS DISTINCT FROM 'borrada'`, [loteId]
  );
  const suma = estados => Math.round(facturas
    .filter(f => estados.includes(f.estado_revision))
    .reduce((acc, f) => acc + (importeDeFactura(f) || 0), 0) * 100) / 100;

  const { rows: [p] } = await query(
    `SELECT COALESCE(SUM(importe), 0) AS total_pagado FROM pagos WHERE lote_id = $1`, [loteId]
  );
  const totalPagado = Number(p.total_pagado);
  const aceptadoPendienteDePago = suma(['aceptada']);
  return {
    totalSinRevisar: suma(['subida']),
    totalAceptado: suma(['aceptada', 'cerrada']),
    totalRechazado: suma(['rechazada']),
    totalPagado,
    pendiente: Math.round((aceptadoPendienteDePago - totalPagado) * 100) / 100,
    pendientesRevision: facturas.filter(f => f.estado_revision === 'subida').length,
  };
}

async function listarFacturasPendientesPorProyecto(proyectoId) {
  const { rows } = await query(
    `SELECT f.id, f.concepto, f.totales, f.estado_revision, f.creado_en, 'colaborador' AS pagado_por,
            l.id AS lote_id, c.nombre AS colaborador_nombre
     FROM facturas f
     JOIN lotes l ON l.id = f.lote_id
     JOIN colaboradores c ON c.id = l.colaborador_id
     WHERE l.proyecto_id = $1 AND f.estado_revision IN ('subida', 'aceptada')
     UNION ALL
     SELECT f.id, f.concepto, f.totales, f.estado_revision, f.creado_en, 'nol' AS pagado_por,
            NULL AS lote_id, c.nombre AS colaborador_nombre
     FROM facturas f
     LEFT JOIN colaboradores c ON c.id = f.subido_por
     WHERE f.lote_id IS NULL AND f.proyecto_id = $1 AND f.estado NOT IN ('matcheada')
     ORDER BY colaborador_nombre, creado_en`,
    [proyectoId]
  );

  return rows.map(r => ({
    ...r,
    importe_declarado: importeDeFactura(r),
  }));
}

module.exports = {
  crearLote, buscarOCrearLote, trimestreActual, listarLotesPorTrimestre, listarTodosLosLotes, listarLotesPorColaborador, obtenerLote,
  listarFacturasDeLote, subirFacturaLote, actualizarFactura, eliminarFactura,
  corregirFacturaColaborador, retirarFacturaColaborador, calcularTotales, listarFacturasPendientesPorProyecto,
};
