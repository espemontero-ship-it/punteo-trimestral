const { obtenerSesion } = require('../../../../lib/auth.cjs');
const { obtenerColaborador } = require('../../../../lib/colaboradores.cjs');
const { listarLotesPorColaborador } = require('../../../../lib/lotes.cjs');
const { crearInvitacion } = require('../../../../lib/tokens.cjs');
const { enviarInvitacion } = require('../../../../lib/email.cjs');

export async function POST(request) {
  const sesion = await obtenerSesion(request);
  if (!sesion || sesion.rol !== 'colaborador') return Response.json({ error: 'No autorizado' }, { status: 403 });

  const colaborador = await obtenerColaborador(sesion.colaboradorId);
  if (!colaborador || !colaborador.puede_invitar) {
    return Response.json({ error: 'No tienes permiso para invitar.' }, { status: 403 });
  }

  const { nombre, usuario, proyecto } = await request.json();
  if (!nombre || !usuario || !proyecto) {
    return Response.json({ error: 'Faltan nombre, correo y proyecto.' }, { status: 400 });
  }

  const misLotes = await listarLotesPorColaborador(sesion.colaboradorId);
  if (!misLotes.some(l => l.evento === proyecto)) {
    return Response.json({ error: 'Solo puedes invitar a tu propio proyecto.' }, { status: 403 });
  }

  const token = await crearInvitacion({ nombre, usuario, proyecto, invitadoPor: sesion.colaboradorId });
  const enlace = `${process.env.SITE_URL || ''}/invitacion/${token}`;
  await enviarInvitacion(usuario, { nombre, proyecto, enlace });

  return Response.json({ ok: true, enlace });
}
