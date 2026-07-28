const { query } = require('../../../../../lib/db.cjs');
const { eliminarBlob } = require('../../../../../lib/blob.cjs');

export async function GET(request, { params }) {
  const { id } = await params;
  const { rows } = await query(
    `SELECT id, numero, nombre_original, proveedor_clave, estado, es_imagen, importes, totales, concepto, creado_en
     FROM facturas WHERE trimestre_id = $1 AND lote_id IS NULL ORDER BY numero`,
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
