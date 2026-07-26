const { SESSION_COOKIE } = require('../../../lib/auth.cjs');

export async function POST() {
  const response = Response.json({ ok: true });
  response.headers.set('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  return response;
}
