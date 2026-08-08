// Envoltorio fino sobre Resend. Si RESEND_API_KEY no está configurada (p.ej.
// mientras no exista todavía cuenta/dominio verificado), no falla: escribe el
// enlace en los logs para poder probar el flujo de invitación/recuperación
// de punta a punta sin depender del correo real.

let resendClient = null;
function getResend() {
  if (!process.env.RESEND_API_KEY) return null;
  if (!resendClient) {
    const { Resend } = require('resend');
    resendClient = new Resend(process.env.RESEND_API_KEY);
  }
  return resendClient;
}

const FROM = process.env.EMAIL_FROM || 'Punteo <onboarding@resend.dev>';

async function enviarCorreo({ to, subject, html, logFallback }) {
  const resend = getResend();
  if (!resend) {
    console.log(`[email] RESEND_API_KEY no configurada -- no se envía correo real.\n${logFallback}`);
    return { enviado: false };
  }
  await resend.emails.send({ from: FROM, to, subject, html });
  return { enviado: true };
}

async function enviarInvitacion(destinatario, { nombre, proyecto, enlace }) {
  return enviarCorreo({
    to: destinatario,
    subject: `Te han invitado a subir facturas de ${proyecto}`,
    html: `<p>Hola ${nombre},</p><p>Te han dado de alta para subir tus facturas de <strong>${proyecto}</strong>. Elige tu contraseña aquí:</p><p><a href="${enlace}">${enlace}</a></p><p>El enlace caduca en 7 días.</p>`,
    logFallback: `Invitación para ${destinatario} (${nombre} · ${proyecto}): ${enlace}`,
  });
}

async function enviarRecuperacion(destinatario, { enlace }) {
  return enviarCorreo({
    to: destinatario,
    subject: 'Recuperar tu contraseña',
    html: `<p>Has pedido recuperar tu contraseña. Elige una nueva aquí:</p><p><a href="${enlace}">${enlace}</a></p><p>El enlace caduca en 2 horas. Si no has sido tú, ignora este correo.</p>`,
    logFallback: `Recuperación para ${destinatario}: ${enlace}`,
  });
}

module.exports = { enviarInvitacion, enviarRecuperacion };
