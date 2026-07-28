const { query } = require('../../../../../lib/db.cjs');
const { eliminarBlob } = require('../../../../../lib/blob.cjs');
const { asegurarColumnasMotivo } = require('../../../../../lib/facturaMatcher.cjs');

export async function GET(request, { params }) {
  const { id } = await params;
  await asegurarColumnasMotivo();
  const { rows } = await query(
    `SELECT f.id, f.numero, f.nombre_original, f.proveedor_clave, f.estado, f.es_imagen,
            f.importes, f.totales, f.fechas, f.concepto, f.creado_en, f.motivo_tipo, f.motivo_detalle,
            m.id AS movimiento_id, m.fecha AS movimiento_fecha, m.concepto AS movimiento_concepto, m.importe AS movimiento_importe
     FROM facturas f
     LEFT JOIN movimiento_facturas mf ON mf.factura_id = f.id
     LEFT JOIN movimientos m ON m.id = mf.movimiento_id
     WHERE f.trimestre_id = $1 AND f.lote_id IS NULL
     ORDER BY f.numero`,
    [id]
  );
  return Response.json({ facturas: rows });
}

// Borra facturas sueltas (ej. duplicadas de una subida repetida). Si alguna
// estaba emparejada con una línea del banco y era la única factura que la
// resolvía, esa línea vuelve a quedar pendiente en vez de "resuelta a medias".
export async function DELETE(request, { params }) {
  const { id } = await params;
  const { ids } = await request.json();
  if (!Array.isArray(ids) || ids.length === 0) {
    return Response.json({ error: 'Nada que borrar.' }, { status: 400 });
  }

  const { rows: aBorrar } = await query(
    `SELECT id, ruta_blob FROM facturas WHERE id = ANY($1::bigint[]) AND trimestre_id = $2`,
    [ids, id]
  );
  const idsReales = aBorrar.map(f => f.id);
  if (idsReales.length === 0) return Response.json({ ok: true, borradas: 0 });

  const { rows: movimientosAfectados } = await query(
    `SELECT DISTINCT movimiento_id FROM movimiento_facturas WHERE factura_id = ANY($1::bigint[])`,
    [idsReales]
  );

  await query(`DELETE FROM facturas WHERE id = ANY($1::bigint[])`, [idsReales]);

  for (const { movimiento_id } of movimientosAfectados) {
    const { rows: restantes } = await query(
      `SELECT 1 FROM movimiento_facturas WHERE movimiento_id = $1 LIMIT 1`,
      [movimiento_id]
    );
    if (restantes.length === 0) {
      await query(`UPDATE movimientos SET estado = 'sin_resolver', nota_final = NULL WHERE id = $1`, [movimiento_id]);
    }
  }

  for (const f of aBorrar) {
    try { await eliminarBlob(f.ruta_blob); } catch { /* archivo ya no existe o falla el borrado — no bloquea */ }
  }

  return Response.json({ ok: true, borradas: idsReales.length });
}
