const { query } = require('../../../../lib/db.cjs');

// Borra un trimestre entero (movimientos, facturas, memoria del excel original).
// Pensado sobre todo para limpiar trimestres de prueba.
export async function DELETE(request, { params }) {
  const { id } = await params;
  await query(`DELETE FROM trimestres WHERE id = $1`, [id]);
  return Response.json({ ok: true });
}
