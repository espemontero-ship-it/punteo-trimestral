const { query } = require('./db.cjs');
const { siguienteNumero, facturaConMismaHuella, asegurarColumnasMotivo } = require('./facturaMatcher.cjs');
const { descargarBlob, eliminarBlob } = require('./blob.cjs');
const { importeDeFactura } = require('./importeFactura.cjs');

let esquemaListo = false;
async function asegurarEsquemaReembolso() {
  if (esquemaListo) return;
  await query(`ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS estado TEXT NOT NULL DEFAULT 'abierto'`);
  await query(`ALTER TABLE pagos ADD COLUMN IF NOT EXISTS es_efectivo BOOLEAN NOT NULL DEFAULT false`);
  await query(`ALTER TABLE pagos ADD COLUMN IF NOT EXISTS consumido_en_pago_id BIGINT REFERENCES pagos(id) ON DELETE SET NULL`);
  await query(`ALTER TABLE facturas ADD COLUMN IF NOT EXISTS pago_id BIGINT REFERENCES pagos(id) ON DELETE SET NULL`);
  await query(`CREATE INDEX IF NOT EXISTS idx_facturas_pago ON facturas(pago_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_pagos_consumido ON pagos(consumido_en_pago_id)`);
  await query(`ALTER TABLE lotes DROP COLUMN IF EXISTS trimestre_id`);
  await query(`ALTER TABLE facturas DROP COLUMN IF EXISTS trimestre_id`);
  await query(`DROP TABLE IF EXISTS pago_facturas`);
  await query(`DROP TABLE IF EXISTS excels_originales`);
  await query(`DROP TABLE IF EXISTS trimestres`);
  await query(`CREATE UNIQUE INDEX IF NOT EXISTS lotes_colaborador_proyecto ON lotes(colaborador_id, proyecto_id)`);
  esquemaListo = true;
}

async function buscarOCrearLote(colaboradorId, proyectoId) {
  await asegurarEsquemaReembolso();
  const { rows } = await query(
    `SELECT id FROM lotes WHERE colaborador_id = $1 AND proyecto_id = $2`,
    [colaboradorId, proyectoId]
  );
  if (rows[0]) return rows[0].id;

  const { rows: proyectoRows } = await query(`SELECT nombre FROM proyectos WHERE id = $1`, [proyectoId]);
  if (!proyectoRows[0]) throw Object.assign(new Error('Proyecto no encontrado.'), { status: 404 });
  const { rows: creado } = await query(
    `INSERT INTO lotes (colaborador_id, evento, proyecto_id) VALUES ($1, $2, $3) RETURNING id`,
    [colaboradorId, proyectoRows[0].nombre, proyectoId]
  );
  return creado[0].id;
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

async function listarTodosLosLotes() {
  await asegurarEsquemaReembolso();
  const { rows } = await query(
    `SELECT l.id, p.nombre AS evento, l.proyecto_id, p.estado AS proyecto_estado, l.creado_en,
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
      total_aceptado: sumarImportes(lista, f => f.estado === 'aceptada'),
    };
  });
}

async function listarLotesPorColaborador(colaboradorId) {
  await asegurarEsquemaReembolso();
  const { rows } = await query(
    `SELECT l.id, p.nombre AS evento, l.proyecto_id, p.estado AS proyecto_estado, l.creado_en
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
  await asegurarEsquemaReembolso();
  const { rows } = await query(
    `SELECT l.id, p.nombre AS evento, l.proyecto_id, p.estado AS proyecto_estado,
            l.creado_en, c.id AS colaborador_id, c.nombre AS colaborador_nombre
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
  await asegurarEsquemaReembolso();
  const { rows } = await query(
    `SELECT id, numero, nombre_original, ruta_blob, concepto, totales, proveedor, importe_a_mano,
            fechas, estado_revision, motivo_rechazo, pago_id, es_imagen, creado_en
     FROM facturas WHERE lote_id = $1 AND estado_revision IS DISTINCT FROM 'borrada' ORDER BY creado_en`,
    [loteId]
  );
  return rows;
}

async function subirFacturaLote({ loteId, rutaBlob, nombreOriginal, concepto, analisis }) {
  await asegurarEsquemaReembolso();
  const { rows: loteRows } = await query(
    `SELECT p.estado FROM lotes l JOIN proyectos p ON p.id = l.proyecto_id WHERE l.id = $1`,
    [loteId]
  );
  if (loteRows[0]?.estado === 'cerrado') {
    throw Object.assign(new Error('Este proyecto ya está cerrado. No se pueden subir más facturas.'), { status: 409 });
  }

  const yaSubida = await facturaConMismaHuella(analisis.huella);
  if (yaSubida) {
    try { await eliminarBlob(rutaBlob); } catch {  }
    throw Object.assign(new Error('This file has already been uploaded. It has not been saved again.'), { status: 409 });
  }

  const numero = await siguienteNumero();
  const { rows } = await query(
    `INSERT INTO facturas (lote_id, ruta_blob, nombre_original, numero, concepto,
                            totales, fechas, proveedor, huella, estado_revision, estado)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'aceptada','revisar')
     RETURNING id, numero`,
    [loteId, rutaBlob, nombreOriginal, numero, concepto || null,
     analisis.totales || [], (analisis.fechas || []).map(f => f.toISOString().slice(0, 10)),
     analisis.proveedorIA || null, analisis.huella || null]
  );
  return { ...rows[0], motivoIA: analisis.motivoIA || null };
}

async function facturaSuyaCorregible(colaboradorId, facturaId) {
  await asegurarEsquemaReembolso();
  const { rows } = await query(
    `SELECT f.id, f.ruta_blob, f.estado_revision, l.colaborador_id, p.estado AS proyecto_estado
     FROM facturas f JOIN lotes l ON l.id = f.lote_id JOIN proyectos p ON p.id = l.proyecto_id
     WHERE f.id = $1`, [facturaId]
  );
  const f = rows[0];
  if (!f) throw Object.assign(new Error('Factura no encontrada.'), { status: 404 });
  if (String(f.colaborador_id) !== String(colaboradorId)) {
    throw Object.assign(new Error('Esa factura no es tuya.'), { status: 403 });
  }
  if (f.proyecto_estado === 'cerrado') {
    throw Object.assign(new Error('Este proyecto ya está cerrado.'), { status: 409 });
  }
  if (f.estado_revision !== 'aceptada') {
    throw Object.assign(new Error('Esta factura ya está revisada: pide el cambio a la administración.'), { status: 409 });
  }
  return f;
}

async function corregirFacturaColaborador(colaboradorId, facturaId, { concepto, importe, fecha }) {
  await facturaSuyaCorregible(colaboradorId, facturaId);
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
  const f = await facturaSuyaCorregible(colaboradorId, facturaId);
  await query(`DELETE FROM facturas WHERE id = $1`, [facturaId]);
  try { await eliminarBlob(f.ruta_blob); } catch {  }
}

async function actualizarFactura(facturaId, { concepto, importe, fecha, estadoRevision, motivoRechazo }) {
  const { rows } = await query(`SELECT estado_revision FROM facturas WHERE id = $1`, [facturaId]);
  if (!rows[0]) throw Object.assign(new Error('Factura no encontrada.'), { status: 404 });
  if (rows[0].estado_revision === 'pagada') {
    throw Object.assign(new Error('Esta factura ya está pagada, no se puede editar.'), { status: 409 });
  }

  await query(
    `UPDATE facturas SET
       concepto = COALESCE($2, concepto),
       totales = CASE WHEN $3::numeric IS NOT NULL THEN ARRAY[$3::numeric] ELSE totales END,
       importe_a_mano = CASE WHEN $3::numeric IS NOT NULL THEN true ELSE importe_a_mano END,
       fechas = CASE WHEN $4::date IS NOT NULL THEN ARRAY[$4::date] ELSE fechas END,
       estado_revision = COALESCE($5, estado_revision),
       motivo_rechazo = $6
     WHERE id = $1`,
    [facturaId, concepto ?? null, importe ?? null, fecha ?? null, estadoRevision ?? null, motivoRechazo ?? null]
  );
}

async function eliminarFactura(facturaId) {
  const { rows } = await query(`SELECT estado_revision FROM facturas WHERE id = $1`, [facturaId]);
  if (!rows[0]) throw Object.assign(new Error('Factura no encontrada.'), { status: 404 });
  if (rows[0].estado_revision === 'pagada') {
    throw Object.assign(new Error('Esta factura ya está pagada, no se puede borrar.'), { status: 409 });
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
    `SELECT COALESCE(SUM(importe), 0) AS total_pagado FROM pagos WHERE lote_id = $1 AND movimiento_id IS NOT NULL`,
    [loteId]
  );
  const { rows: [a] } = await query(
    `SELECT COALESCE(SUM(importe), 0) AS total_anticipos FROM pagos
     WHERE lote_id = $1 AND consumido_en_pago_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM facturas f WHERE f.pago_id = pagos.id)`,
    [loteId]
  );
  const totalAceptado = suma(['aceptada']);
  return {
    totalAceptado,
    totalPagado: suma(['pagada']),
    totalRechazado: suma(['rechazada']),
    totalConciliado: Number(p.total_pagado),
    pendienteDePagar: Math.round((totalAceptado - Number(a.total_anticipos)) * 100) / 100,
  };
}

async function listarFacturasPendientesPorProyecto(proyectoId) {
  const { rows } = await query(
    `SELECT f.id, f.concepto, f.totales, f.estado_revision, f.creado_en, 'colaborador' AS pagado_por,
            l.id AS lote_id, c.nombre AS colaborador_nombre
     FROM facturas f
     JOIN lotes l ON l.id = f.lote_id
     JOIN colaboradores c ON c.id = l.colaborador_id
     WHERE l.proyecto_id = $1 AND f.estado_revision = 'aceptada'
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
  buscarOCrearLote, listarTodosLosLotes, listarLotesPorColaborador, obtenerLote,
  listarFacturasDeLote, subirFacturaLote, actualizarFactura, eliminarFactura,
  corregirFacturaColaborador, retirarFacturaColaborador, calcularTotales, listarFacturasPendientesPorProyecto,
  asegurarEsquemaReembolso,
};
