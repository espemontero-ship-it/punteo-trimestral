// Envío por SMTP de Google Workspace (nodemailer), no por un servicio nuevo
// como Resend -- así no hace falta verificar ningún dominio aparte. Si
// SMTP_USER/SMTP_APP_PASSWORD no están configuradas todavía, no falla:
// escribe el enlace en los logs para poder probar el flujo de
// invitación/recuperación de punta a punta sin depender del correo real.

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
  const motivo = proyecto ? `tus facturas de <strong>${proyecto}</strong>` : 'facturas generales de NotOnlyLarp';
  return enviarCorreo({
    to: destinatario,
    subject: proyecto ? `Te han invitado a subir facturas de ${proyecto}` : 'Te han invitado a subir facturas de NotOnlyLarp',
    html: `<p>Hola ${nombre},</p><p>Te han dado de alta para subir ${motivo}. Elige tu contraseña aquí:</p><p><a href="${enlace}">${enlace}</a></p><p>El enlace caduca en 7 días.</p>`,
    logFallback: `Invitación para ${destinatario} (${nombre} · ${proyecto || 'sin proyecto'}): ${enlace}`,
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
