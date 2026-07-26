const { confirmarGrupo } = require('../../../../../../lib/agrupador.cjs');

export async function POST(request, { params }) {
  const { id } = await params;
  const { hoja, clave, nota } = await request.json();
  if (!hoja || !clave || !nota) {
    return Response.json({ error: 'Faltan datos (hoja, clave, nota).' }, { status: 400 });
  }
  const lineas = await confirmarGrupo(id, hoja, clave, nota);
  return Response.json({ ok: true, lineas });
}
