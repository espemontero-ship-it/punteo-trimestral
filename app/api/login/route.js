const { crearTokenSesion, SESSION_COOKIE, DURACION_MS } = require('../../../lib/auth.cjs');
const { verificarColaborador } = require('../../../lib/colaboradores.cjs');

export async function POST(request) {
  const { usuario, password } = await request.json();

  if (!usuario) {
    return Response.json({ error: 'Falta el correo.' }, { status: 401 });
  }

  const colaborador = await verificarColaborador(usuario, password);
  if (!colaborador) {
    return Response.json({ error: 'Usuario o contraseña incorrectos' }, { status: 401 });
  }

  if (colaborador.estado === 'inactivo') {
    return Response.json({ error: 'Tu cuenta está inactiva. Habla con la administración.' }, { status: 403 });
  }

  const payload = { rol: colaborador.rol, colaboradorId: colaborador.id, nombre: colaborador.nombre };
  const redirect = colaborador.rol === 'admin' ? '/' : '/colaborador';

  const token = await crearTokenSesion(payload);
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  const response = Response.json({ ok: true, redirect });
  response.headers.set(
    'Set-Cookie',
    `${SESSION_COOKIE}=${token}; Path=/; HttpOnly${secure}; SameSite=Lax; Max-Age=${Math.floor(DURACION_MS / 1000)}`
  );
  return response;
}
