const { query } = require('../../../lib/db.cjs');

export async function GET() {
  const { rows } = await query(
    `SELECT t.id, t.creado_en, t.cerrado,
            COUNT(m.id) AS total,
            COUNT(m.id) FILTER (WHERE m.estado = 'resuelta') AS resueltas
     FROM trimestres t
     LEFT JOIN movimientos m ON m.trimestre_id = t.id
     GROUP BY t.id, t.creado_en, t.cerrado
     ORDER BY t.creado_en DESC`
  );
  return Response.json({ trimestres: rows });
}

export async function POST(request) {
  const { id } = await request.json();
  const limpio = (id || '').trim();
  if (!limpio) return Response.json({ error: 'Falta el nombre del trimestre.' }, { status: 400 });

  await query(`INSERT INTO trimestres (id) VALUES ($1) ON CONFLICT DO NOTHING`, [limpio]);
  return Response.json({ ok: true, id: limpio });
}
