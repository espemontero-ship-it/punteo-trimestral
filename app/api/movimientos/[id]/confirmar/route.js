const { confirmarLinea } = require('../../../../../lib/agrupador.cjs');
const { confirmarMatch } = require('../../../../../lib/facturaMatcher.cjs');

export async function POST(request, { params }) {
  const { id } = await params;
  const { nota, facturaIds } = await request.json();

  if (Array.isArray(facturaIds) && facturaIds.length) {
    if (!nota) return Response.json({ error: 'Falta la nota.' }, { status: 400 });
    await confirmarMatch(Number(id), facturaIds, nota);
  } else {
    // La nota es opcional al marcar una línea como resuelta a mano.
    await confirmarLinea(Number(id), nota);
  }

  return Response.json({ ok: true });
}
