const { verificarPassword, crearTokenSesion, SESSION_COOKIE, DURACION_MS } = require('../../../lib/auth.cjs');

export async function POST(request) {
  const { password } = await request.json();

  if (!verificarPassword(password)) {
    return Response.json({ error: 'Contraseña incorrecta' }, { status: 401 });
  }

  const token = await crearTokenSesion();
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  const response = Response.json({ ok: true });
  response.headers.set(
    'Set-Cookie',
    `${SESSION_COOKIE}=${token}; Path=/; HttpOnly${secure}; SameSite=Lax; Max-Age=${Math.floor(DURACION_MS / 1000)}`
  );
  return response;
}
