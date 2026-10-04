const { desvincularFactura } = require('../../../../../lib/facturaMatcher.cjs');

export async function POST(request, { params }) {
  const { id } = await params;
  const { movimientoId } = await request.json();
  try {
    await desvincularFactura(Number(id), Number(movimientoId));
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: e.message || 'No se pudo desvincular.' }, { status: e.status || 500 });
  }
}
