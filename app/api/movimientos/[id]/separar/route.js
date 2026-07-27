const { separarDeGrupo } = require('../../../../../lib/agrupador.cjs');

export async function POST(request, { params }) {
  const { id } = await params;
  await separarDeGrupo(Number(id));
  return Response.json({ ok: true });
}
