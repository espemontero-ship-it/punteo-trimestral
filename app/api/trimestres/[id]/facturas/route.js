const { query } = require('../../../../../lib/db.cjs');

export async function GET(request, { params }) {
  const { id } = await params;
  const { rows } = await query(
    `SELECT id, numero, nombre_original, proveedor_clave, estado, es_imagen
     FROM facturas WHERE trimestre_id = $1 ORDER BY numero`,
    [id]
  );
  return Response.json({ facturas: rows });
}
