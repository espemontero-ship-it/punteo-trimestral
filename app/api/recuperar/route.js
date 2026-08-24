const { query } = require('../../../lib/db.cjs');
const { crearRestablecimiento } = require('../../../lib/tokens.cjs');
const { enviarRecuperacion } = require('../../../lib/email.cjs');

export async function POST(request) {
  const { usuario } = await request.json();
  if (usuario) {
    const { rows } = await query(`SELECT id FROM colaboradores WHERE usuario = $1`, [usuario]);
    if (rows[0]) {
      const token = await crearRestablecimiento(rows[0].id);
      const enlace = `${process.env.SITE_URL || ''}/restablecer/${token}`;
      await enviarRecuperacion(usuario, { enlace });
    }
  }
  return Response.json({ ok: true, mensaje: "If that email has an account, you've got a link to choose a new password." });
}
