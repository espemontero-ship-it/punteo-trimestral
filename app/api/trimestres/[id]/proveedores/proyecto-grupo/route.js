const { asignarProyectoGrupo } = require('../../../../../../lib/agrupador.cjs');

export async function POST(request, { params }) {
  const { id } = await params;
  const { hoja, clave, proyectoId } = await request.json();
  if (!hoja || !clave) {
    return Response.json({ error: 'Faltan datos (hoja, clave).' }, { status: 400 });
  }
  await asignarProyectoGrupo(id, hoja, clave, proyectoId);
  return Response.json({ ok: true });
}
