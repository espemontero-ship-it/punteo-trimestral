const { query } = require('../../../../../lib/db.cjs');

export async function GET(request, { params }) {
  const { id } = await params;
  const { rows } = await query(
    `SELECT id, hoja, fecha, concepto, importe FROM movimientos
     WHERE trimestre_id = $1 AND estado IN ('sin_resolver', 'pedida_pendiente')
     ORDER BY fecha DESC NULLS LAST`,
    [id]
  );
  return Response.json({ movimientos: rows });
}
