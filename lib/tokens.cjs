const crypto = require('crypto');
const { query } = require('./db.cjs');

const DURACION_INVITACION_MS = 1000 * 60 * 60 * 24 * 7; // 7 días
const DURACION_RESTABLECIMIENTO_MS = 1000 * 60 * 60 * 2; // 2 horas

function generarToken() {
  return crypto.randomBytes(32).toString('hex');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Nunca se guarda el token en claro -- solo su hash. El token en claro solo
// vive en el enlace del correo (y, mientras no haya Resend configurado, en
// los logs/la respuesta de la API para poder probar el flujo).
// `proyectoId` es opcional -- una invitación sin proyecto es para alguien que
// solo va a subir facturas generales de NOL, sin ningún lote.
async function crearInvitacion({ nombre, usuario, proyectoId, invitadoPor, puedeSubirFacturasGenerales }) {
  const token = generarToken();
  const expiraEn = new Date(Date.now() + DURACION_INVITACION_MS);
  await query(
    `INSERT INTO tokens_acceso (tipo, token_hash, nombre, usuario, proyecto_id, invitado_por, expira_en, puede_subir_facturas_generales)
     VALUES ('invitacion', $1, $2, $3, $4, $5, $6, $7)`,
    [hashToken(token), nombre, usuario, proyectoId || null, invitadoPor || null, expiraEn, !!puedeSubirFacturasGenerales]
  );
  return token;
}

async function crearRestablecimiento(colaboradorId) {
  const token = generarToken();
  const expiraEn = new Date(Date.now() + DURACION_RESTABLECIMIENTO_MS);
  await query(
    `INSERT INTO tokens_acceso (tipo, token_hash, colaborador_id, expira_en)
     VALUES ('restablecimiento', $1, $2, $3)`,
    [hashToken(token), colaboradorId, expiraEn]
  );
  return token;
}

// Solo consulta, no marca el token como usado -- para poder mostrar datos
// (nombre/proyecto) antes de pedir la contraseña, sin gastar la invitación.
async function verTokenPendiente(token, tipo) {
  const { rows } = await query(
    `SELECT t.id, t.nombre, t.usuario, t.proyecto_id, p.nombre AS proyecto, t.colaborador_id, t.puede_subir_facturas_generales
     FROM tokens_acceso t
     LEFT JOIN proyectos p ON p.id = t.proyecto_id
     WHERE t.token_hash = $1 AND t.tipo = $2 AND t.usado_en IS NULL AND t.expira_en > now()`,
    [hashToken(token), tipo]
  );
  return rows[0] || null;
}

// Valida y consume el token en un único paso atómico (UPDATE ... RETURNING),
// para que dos peticiones simultáneas con el mismo token no puedan usarlo dos
// veces. Nunca revela por qué ha fallado (caducado vs ya usado vs inventado).
async function consumirToken(token, tipo) {
  const { rows } = await query(
    `UPDATE tokens_acceso SET usado_en = now()
     WHERE token_hash = $1 AND tipo = $2 AND usado_en IS NULL AND expira_en > now()
     RETURNING id, nombre, usuario, proyecto_id, colaborador_id, invitado_por, puede_subir_facturas_generales`,
    [hashToken(token), tipo]
  );
  return rows[0] || null;
}

module.exports = { crearInvitacion, crearRestablecimiento, verTokenPendiente, consumirToken };
