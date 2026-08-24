let transporter = null;
function getTransporter() {
  if (!process.env.SMTP_USER || !process.env.SMTP_APP_PASSWORD) return null;
  if (!transporter) {
    const nodemailer = require('nodemailer');
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_APP_PASSWORD },
    });
  }
  return transporter;
}

async function enviarCorreo({ to, subject, html, logFallback }) {
  const t = getTransporter();
  if (!t) {
    console.log(`[email] SMTP_USER/SMTP_APP_PASSWORD no configuradas -- no se envía correo real.\n${logFallback}`);
    return { enviado: false };
  }
  await t.sendMail({ from: process.env.EMAIL_FROM || process.env.SMTP_USER, to, subject, html });
  return { enviado: true };
}

async function enviarInvitacion(destinatario, { nombre, proyecto, enlace }) {
  const motivo = proyecto ? `your invoices for <strong>${proyecto}</strong>` : 'general NotOnlyLarp invoices';
  return enviarCorreo({
    to: destinatario,
    subject: 'App invoices NOL',
    html: `<p>Hi ${nombre},</p><p>You've been given access to upload ${motivo}. Choose your password here:</p><p><a href="${enlace}">${enlace}</a></p><p>This link expires in 7 days.</p>`,
    logFallback: `Invitación para ${destinatario} (${nombre} · ${proyecto || 'sin proyecto'}): ${enlace}`,
  });
}

async function enviarRecuperacion(destinatario, { enlace }) {
  return enviarCorreo({
    to: destinatario,
    subject: 'App invoices NOL',
    html: `<p>You requested to reset your password. Choose a new one here:</p><p><a href="${enlace}">${enlace}</a></p><p>This link expires in 2 hours. If this wasn't you, just ignore this email.</p>`,
    logFallback: `Recuperación para ${destinatario}: ${enlace}`,
  });
}

module.exports = { enviarInvitacion, enviarRecuperacion };
