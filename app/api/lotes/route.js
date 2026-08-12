const { crearColaboradorYLote, listarTodosLosLotes } = require('../../../lib/lotes.cjs');

export async function GET() {
  const lotes = await listarTodosLosLotes();
  return Response.json({ lotes });
}

export async function POST(request) {
  const { nombre, usuario, proyectoId } = await request.json();
  if (!nombre || !usuario || !proyectoId) {
    return Response.json({ error: 'Faltan nombre, correo y proyecto.' }, { status: 400 });
  }

  try {
    const { colaborador, loteId, password } = await crearColaboradorYLote(nombre, usuario, proyectoId);
    return Response.json({ ok: true, colaborador, loteId, password });
  } catch (err) {
    if (err.code === '23505') return Response.json({ error: 'Ya existe un colaborador con ese correo.' }, { status: 409 });
    throw err;
  }
}
