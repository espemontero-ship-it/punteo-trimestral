const { del, get } = require('@vercel/blob');

// El store es privado (autenticación por OIDC en Vercel), así que no basta con
// un fetch normal — hay que pasar por el SDK, que firma la petición.
async function descargarBlob(url) {
  const resultado = await get(url, { access: 'private' });
  if (!resultado) throw new Error('No se encontró el archivo subido (puede que se haya borrado).');
  const arrayBuffer = await new Response(resultado.stream).arrayBuffer();
  return Buffer.from(arrayBuffer);
}

module.exports = { descargarBlob, eliminarBlob: del };
