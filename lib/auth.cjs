// Firma/verificación con Web Crypto (no Node `crypto`) para que funcione tanto
// en rutas API (Node) como en middleware (Edge) sin distinción de runtime.

const SESSION_COOKIE = 'punteo_sesion';
const DURACION_MS = 1000 * 60 * 60 * 24 * 30; // 30 días

function getSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error('Falta AUTH_SECRET en las variables de entorno.');
  return secret;
}

function toHex(buffer) {
  return [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}

async function importKey(secret) {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

async function sign(value) {
  const key = await importKey(getSecret());
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return `${value}.${toHex(sig)}`;
}

async function unsign(signed) {
  const idx = signed.lastIndexOf('.');
  if (idx === -1) return null;
  const value = signed.slice(0, idx);
  const hexSig = signed.slice(idx + 1);
  const key = await importKey(getSecret());
  const valido = await crypto.subtle.verify('HMAC', key, fromHex(hexSig), new TextEncoder().encode(value));
  return valido ? value : null;
}

function verificarPassword(password) {
  const real = process.env.AUTH_PASSWORD || '';
  const a = new TextEncoder().encode(password || '');
  const b = new TextEncoder().encode(real);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function crearTokenSesion() {
  const expira = Date.now() + DURACION_MS;
  return sign(`ok:${expira}`);
}

async function sesionValida(token) {
  if (!token) return false;
  const value = await unsign(token);
  if (!value) return false;
  const [, expiraStr] = value.split(':');
  return Date.now() < Number(expiraStr);
}

module.exports = { verificarPassword, crearTokenSesion, sesionValida, SESSION_COOKIE, DURACION_MS };
