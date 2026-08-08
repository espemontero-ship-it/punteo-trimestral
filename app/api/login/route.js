const { verificarPassword, crearTokenSesion, SESSION_COOKIE, DURACION_MS } = require('../../../lib/auth.cjs');
const { verificarColaborador } = require('../../../lib/colaboradores.cjs');

export async function POST(request) {
  const { usuario, password } = await request.json();

  let payload;
  let redirect = '/';

  if (usuario) {
    const colaborador = await verificarColaborador(usuario, password);
    if (!colaborador) {
      return Response.json({ error: 'Usuario o contraseña incorrectos' }, { status: 401 });
    }
    payload = { rol: colaborador.rol, colaboradorId: colaborador.id, nombre: colaborador.nombre };
    redirect = colaborador.rol === 'admin' ? '/' : '/colaborador';
  } else {
    if (!verificarPassword(password)) {
      return Response.json({ error: 'Contraseña incorrecta' }, { status: 401 });
    }
    payload = { rol: 'admin' };
  }

  const token = await crearTokenSesion(payload);
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  const response = Response.json({ ok: true, redirect });
  response.headers.set(
    'Set-Cookie',
    `${SESSION_COOKIE}=${token}; Path=/; HttpOnly${secure}; SameSite=Lax; Max-Age=${Math.floor(DURACION_MS / 1000)}`
  );
  return response;
}
