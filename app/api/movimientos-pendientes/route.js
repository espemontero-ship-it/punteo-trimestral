const { query } = require('../../../lib/db.cjs');

export async function GET() {
  const { rows } = await query(
    `SELECT id, hoja, fecha, concepto, importe FROM movimientos
     WHERE estado IN ('sin_resolver', 'pedida_pendiente')
     ORDER BY fecha DESC NULLS LAST`
  );
  return Response.json({ movimientos: rows });
}
