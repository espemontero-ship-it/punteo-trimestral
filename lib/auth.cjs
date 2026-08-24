const SESSION_COOKIE = 'punteo_sesion';
const DURACION_MS = 1000 * 60 * 60 * 24 * 30;

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

async function crearTokenSesion(payload) {
  const expira = Date.now() + DURACION_MS;
  return sign(JSON.stringify({ ...payload, exp: expira }));
}

async function leerSesion(token) {
  if (!token) return null;
  const value = await unsign(token);
  if (!value) return null;
  try {
    const payload = JSON.parse(value);
    if (Date.now() >= payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

async function obtenerSesion(request) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  return leerSesion(token);
}

module.exports = { crearTokenSesion, leerSesion, obtenerSesion, SESSION_COOKIE, DURACION_MS };
