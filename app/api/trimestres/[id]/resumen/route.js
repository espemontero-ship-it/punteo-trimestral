const { query } = require('../../../../../lib/db.cjs');

export async function GET(request, { params }) {
  const { id } = await params;
  const { rows } = await query(
    `SELECT hoja,
            COUNT(*) AS total,
            COUNT(*) FILTER (WHERE estado = 'resuelta') AS resueltas,
            COUNT(*) FILTER (WHERE estado = 'pedida_pendiente') AS pedida_pendiente,
            COUNT(*) FILTER (WHERE estado = 'factura_futura') AS factura_futura,
            COUNT(*) FILTER (WHERE estado = 'sin_resolver') AS sin_resolver
     FROM movimientos WHERE trimestre_id = $1 GROUP BY hoja`,
    [id]
  );

  const total = rows.reduce((acc, r) => acc + Number(r.total), 0);
  const resueltas = rows.reduce((acc, r) => acc + Number(r.resueltas), 0);
  const facturaFutura = rows.reduce((acc, r) => acc + Number(r.factura_futura), 0);

  return Response.json({ porHoja: rows, total, resueltas, facturaFutura });
}
