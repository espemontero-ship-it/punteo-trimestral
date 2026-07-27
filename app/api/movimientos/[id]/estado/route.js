const { marcarLineaPendiente } = require('../../../../../lib/agrupador.cjs');

export async function POST(request, { params }) {
  const { id } = await params;
  const { pedida } = await request.json();
  await marcarLineaPendiente(Number(id), !!pedida);
  return Response.json({ ok: true });
}
