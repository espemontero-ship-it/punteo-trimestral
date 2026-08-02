const { resolverPagoLarpManager } = require('../../../../../lib/larpmanager.cjs');

export async function POST(request, { params }) {
  const { id } = await params;
  const candidato = await request.json();
  try {
    await resolverPagoLarpManager(Number(id), candidato);
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: err.message || 'No se pudo resolver.' }, { status: 500 });
  }
}
