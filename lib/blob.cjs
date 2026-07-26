const { del } = require('@vercel/blob');

// Los blobs de subida se crean como públicos (ver app/api/blob-upload/route.js),
// así que basta con un fetch normal para traer el contenido al servidor.
async function descargarBlob(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`No se pudo descargar el archivo subido (HTTP ${res.status}).`);
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

module.exports = { descargarBlob, eliminarBlob: del };
