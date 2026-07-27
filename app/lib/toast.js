'use client';

let listeners = [];

export function mostrarToast(mensaje, tipo = 'ok') {
  const evento = { id: Date.now() + Math.random(), mensaje, tipo };
  listeners.forEach(fn => fn(evento));
}

export function suscribirToast(fn) {
  listeners.push(fn);
  return () => { listeners = listeners.filter(l => l !== fn); };
}

// Envuelve fetch: si la respuesta no es OK, lanza un toast de error y devuelve
// null en vez de un JSON a medio parsear. Si va bien, muestra un toast opcional.
export async function apiFetch(url, options, { mensajeOk, mensajeError } = {}) {
  let res;
  try {
    res = await fetch(url, options);
  } catch {
    mostrarToast(mensajeError || 'Sin conexión. Reintenta.', 'error');
    return null;
  }
  let data = null;
  try { data = await res.json(); } catch { /* respuesta vacía */ }
  if (!res.ok) {
    mostrarToast((data && data.error) || mensajeError || 'Algo ha fallado. Reintenta.', 'error');
    return null;
  }
  if (mensajeOk) mostrarToast(mensajeOk, 'ok');
  return data;
}
