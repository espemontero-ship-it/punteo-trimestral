const { listarTodosLosLotes } = require('../../../lib/lotes.cjs');
const { altaColaborador } = require('../../../lib/colaboradores.cjs');
const { obtenerSesion } = require('../../../lib/auth.cjs');

export async function GET() {
  const lotes = await listarTodosLosLotes();
  return Response.json({ lotes });
}

export async function POST(request) {
  const sesion = await obtenerSesion(request);
  const { nombre, usuario, proyectoId, puedeSubirFacturasGenerales } = await request.json();
  if (!nombre || !usuario) {
    return Response.json({ error: 'Faltan nombre y correo.' }, { status: 400 });
  }

  try {
    const resultado = await altaColaborador({
      nombre, usuario, proyectoId: proyectoId || null,
      puedeSubirFacturasGenerales: !!puedeSubirFacturasGenerales,
      invitadoPor: sesion?.colaboradorId || null,
    });
    return Response.json({ ok: true, ...resultado });
  } catch (err) {
    if (err.code === '23505') return Response.json({ error: 'Ya existe un colaborador con ese correo.' }, { status: 409 });
    if (err.status) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
