const { obtenerSesion } = require('../../../../lib/auth.cjs');
const { crearInvitacion } = require('../../../../lib/tokens.cjs');
const { enviarInvitacion } = require('../../../../lib/email.cjs');

// Admin-only: invita a alguien SIN proyecto (el caso "solo sube facturas
// generales de NOL, no es colaborador de ningún evento").
export async function POST(request) {
  const sesion = await obtenerSesion(request);
  if (!sesion || sesion.rol !== 'admin') return Response.json({ error: 'No autorizado' }, { status: 403 });

  const { nombre, usuario } = await request.json();
  if (!nombre || !usuario) return Response.json({ error: 'Faltan nombre y correo.' }, { status: 400 });

  const token = await crearInvitacion({ nombre, usuario, puedeSubirFacturasGenerales: true });
  const enlace = `${process.env.SITE_URL || ''}/invitacion/${token}`;
  await enviarInvitacion(usuario, { nombre, proyecto: null, enlace });

  return Response.json({ ok: true, enlace });
}
