const { vincularMovimiento, asociarFacturas } = require('../../../../../lib/pagos.cjs');

export async function POST(request, { params }) {
  const { id } = await params;
  const { movimientoId, facturaIds } = await request.json();
  if (!movimientoId) return Response.json({ error: 'Falta movimientoId.' }, { status: 400 });

  if (Array.isArray(facturaIds)) await asociarFacturas(id, facturaIds);
  await vincularMovimiento(id, movimientoId);
  return Response.json({ ok: true });
}
