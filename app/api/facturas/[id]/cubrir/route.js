const { cubrirMovimientos } = require('../../../../../lib/facturaMatcher.cjs');

export async function POST(request, { params }) {
  const { id } = await params;
  const { movimientoIds, nota } = await request.json();
  try {
    await cubrirMovimientos(Number(id), movimientoIds, nota);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: e.message || 'No se pudo enlazar.' }, { status: e.status || 500 });
  }
}
