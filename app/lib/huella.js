'use client';

export async function huellaDeArchivo(file) {
  const bytes = await file.arrayBuffer();
  const resumen = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(resumen)].map(b => b.toString(16).padStart(2, '0')).join('');
}

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
