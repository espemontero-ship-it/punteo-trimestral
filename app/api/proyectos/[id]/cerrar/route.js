const { cerrarProyecto } = require('../../../../../lib/proyectos.cjs');

export async function POST(request, { params }) {
  const { id } = await params;
  await cerrarProyecto(id);
  return Response.json({ ok: true });
}
