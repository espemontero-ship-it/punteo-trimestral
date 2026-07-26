const { confirmarLinea } = require('../../../../../lib/agrupador.cjs');
const { confirmarMatch } = require('../../../../../lib/facturaMatcher.cjs');

export async function POST(request, { params }) {
  const { id } = await params;
  const { nota, facturaIds } = await request.json();
  if (!nota) return Response.json({ error: 'Falta la nota.' }, { status: 400 });

  if (Array.isArray(facturaIds) && facturaIds.length) {
    await confirmarMatch(Number(id), facturaIds, nota);
  } else {
    await confirmarLinea(Number(id), nota);
  }

  return Response.json({ ok: true });
}
