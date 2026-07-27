const { listarProyectos, crearProyecto } = require('../../../lib/proyectos.cjs');

export async function GET() {
  const proyectos = await listarProyectos();
  return Response.json({ proyectos });
}

export async function POST(request) {
  const { nombre } = await request.json();
  if (!nombre) return Response.json({ error: 'Falta el nombre del proyecto.' }, { status: 400 });

  const proyecto = await crearProyecto(nombre);
  return Response.json({ ok: true, proyecto });
}
