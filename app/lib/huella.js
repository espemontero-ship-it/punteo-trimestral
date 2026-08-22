'use client';

// La huella de un archivo: sha256 de su contenido, calculada en el propio
// navegador antes de subir nada. Es una función que ya trae el navegador
// (crypto.subtle), no cuesta dinero ni pasa por ningún servicio de fuera.
//
// Tiene que dar exactamente el mismo resultado que la que hace el servidor
// (crypto.createHash('sha256') en lib/facturaMatcher.cjs y lib/lotes.cjs):
// los dos leen los bytes del archivo tal cual, sin tocar nada.
export async function huellaDeArchivo(file) {
  const bytes = await file.arrayBuffer();
  const resumen = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(resumen)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Pregunta al servidor si ese archivo ya está subido. Devuelve null si no lo
// está o si la consulta falla -- si falla, se sigue adelante y el que corta es
// el cerrojo del servidor; nunca se bloquea una subida por no poder preguntar.
export async function facturaConEseArchivo(huella) {
  try {
    const r = await fetch(`/api/facturas/huella?h=${encodeURIComponent(huella)}`);
    if (!r.ok) return null;
    const data = await r.json();
    return data.existe ? data : null;
  } catch {
    return null;
  }
}
