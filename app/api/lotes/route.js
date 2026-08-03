const { crearLote, listarTodosLosLotes } = require('../../../lib/lotes.cjs');

export async function GET() {
  const lotes = await listarTodosLosLotes();
  return Response.json({ lotes });
}

export async function POST(request) {
  const { trimestreId, colaboradorId, evento } = await request.json();
  if (!trimestreId || !colaboradorId || !evento) {
    return Response.json({ error: 'Faltan trimestreId, colaboradorId y evento.' }, { status: 400 });
  }

  const loteId = await crearLote(trimestreId, colaboradorId, evento);
  return Response.json({ ok: true, loteId });
}
