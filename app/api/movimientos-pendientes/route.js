const { query } = require('../../../lib/db.cjs');

// Usado por el módulo de colaboradores (vincular un pago de lote a una línea
// del banco) -- ya no hay trimestre que filtrar, es todo el histórico pendiente.
export async function GET() {
  const { rows } = await query(
    `SELECT id, hoja, fecha, concepto, importe FROM movimientos
     WHERE estado IN ('sin_resolver', 'pedida_pendiente')
     ORDER BY fecha DESC NULLS LAST`
  );
  return Response.json({ movimientos: rows });
}
