const { asignarProyecto } = require('../../../../../lib/proyectos.cjs');

export async function POST(request, { params }) {
  const { id } = await params;
  const { proyectoId } = await request.json();
  await asignarProyecto(Number(id), proyectoId ? Number(proyectoId) : null);
  return Response.json({ ok: true });
}
