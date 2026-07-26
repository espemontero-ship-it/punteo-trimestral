const { crearLote, listarLotesPorTrimestre } = require('../../../../../lib/lotes.cjs');

export async function GET(request, { params }) {
  const { id } = await params;
  const lotes = await listarLotesPorTrimestre(id);
  return Response.json({ lotes });
}

export async function POST(request, { params }) {
  const { id } = await params;
  const { colaboradorId, evento } = await request.json();
  if (!colaboradorId || !evento) return Response.json({ error: 'Faltan colaboradorId y evento.' }, { status: 400 });

  const loteId = await crearLote(id, colaboradorId, evento);
  return Response.json({ ok: true, loteId });
}
