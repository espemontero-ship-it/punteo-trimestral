const bcrypt = require('bcryptjs');
const { query } = require('../../../../lib/db.cjs');
const { consumirToken } = require('../../../../lib/tokens.cjs');

export async function POST(request, { params }) {
  const { token } = await params;
  const { password } = await request.json();
  if (!password || password.length < 8) {
    return Response.json({ error: 'La contraseña debe tener al menos 8 caracteres.' }, { status: 400 });
  }

  const restablecimiento = await consumirToken(token, 'restablecimiento');
  if (!restablecimiento) return Response.json({ error: 'Este enlace no es válido o ya ha caducado.' }, { status: 404 });

  const hash = await bcrypt.hash(password, 10);
  await query(`UPDATE colaboradores SET password_hash = $2 WHERE id = $1`, [restablecimiento.colaborador_id, hash]);
  return Response.json({ ok: true });
}
