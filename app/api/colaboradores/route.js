const { crearColaborador, listarColaboradores } = require('../../../lib/colaboradores.cjs');

export async function GET() {
  const colaboradores = await listarColaboradores();
  return Response.json({ colaboradores });
}

export async function POST(request) {
  const { nombre, usuario, password } = await request.json();
  if (!nombre || !usuario) return Response.json({ error: 'Faltan nombre y usuario.' }, { status: 400 });

  try {
    const colaborador = await crearColaborador(nombre, usuario, password);
    return Response.json({ ok: true, colaborador });
  } catch (err) {
    if (err.code === '23505') return Response.json({ error: 'Ya existe un colaborador con ese usuario.' }, { status: 409 });
    throw err;
  }
}
