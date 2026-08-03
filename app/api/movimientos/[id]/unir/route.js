const { unirAGrupo } = require('../../../../../lib/agrupador.cjs');

export async function POST(request, { params }) {
  const { id } = await params;
  const { hoja, clave } = await request.json();
  if (!hoja || !clave) {
    return Response.json({ error: 'Falta hoja o clave del grupo destino.' }, { status: 400 });
  }
  await unirAGrupo(Number(id), hoja, clave);
  return Response.json({ ok: true });
}
