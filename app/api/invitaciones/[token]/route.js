const bcrypt = require('bcryptjs');
const { verTokenPendiente, consumirToken } = require('../../../../lib/tokens.cjs');
const { crearColaboradorDesdeInvitacion } = require('../../../../lib/colaboradores.cjs');
const { crearTokenSesion, SESSION_COOKIE, DURACION_MS } = require('../../../../lib/auth.cjs');

// Solo consulta -- para mostrar "te han invitado a {proyecto}" antes de pedir
// la contraseña, sin gastar la invitación.
export async function GET(request, { params }) {
  const { token } = await params;
  const invitacion = await verTokenPendiente(token, 'invitacion');
  if (!invitacion) return Response.json({ error: 'Este enlace no es válido o ya ha caducado.' }, { status: 404 });
  return Response.json({ nombre: invitacion.nombre, proyecto: invitacion.proyecto, puedeSubirFacturasGenerales: invitacion.puede_subir_facturas_generales });
}

export async function POST(request, { params }) {
  const { token } = await params;
  const { password } = await request.json();
  if (!password || password.length < 8) {
    return Response.json({ error: 'La contraseña debe tener al menos 8 caracteres.' }, { status: 400 });
  }

  const invitacion = await consumirToken(token, 'invitacion');
  if (!invitacion) return Response.json({ error: 'Este enlace no es válido o ya ha caducado.' }, { status: 404 });

  const hash = await bcrypt.hash(password, 10);
  let colaborador, loteId;
  try {
    ({ colaborador, loteId } = await crearColaboradorDesdeInvitacion(
      invitacion.nombre, invitacion.usuario, hash, invitacion.proyecto_id, invitacion.puede_subir_facturas_generales
    ));
  } catch (err) {
    if (err.code === '23505') return Response.json({ error: 'Ya existe una cuenta con ese correo.' }, { status: 409 });
    throw err;
  }

  const sessionToken = await crearTokenSesion({ rol: 'colaborador', colaboradorId: colaborador.id, nombre: colaborador.nombre });
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  const response = Response.json({ ok: true, redirect: '/colaborador' });
  response.headers.set('Set-Cookie',
    `${SESSION_COOKIE}=${sessionToken}; Path=/; HttpOnly${secure}; SameSite=Lax; Max-Age=${Math.floor(DURACION_MS / 1000)}`);
  return response;
}
