const { rechazarSugerencia } = require('../../../../lib/agrupador.cjs');

const TIPOS = ['nota', 'proveedor', 'proyecto', 'devolucion', 'jugador', 'combo', 'pago'];

export async function POST(request) {
  const { hoja, clave, tipo, valor } = await request.json();
  if (!hoja || !clave) {
    return Response.json({ error: 'Faltan datos (hoja, clave).' }, { status: 400 });
  }
  if (!TIPOS.includes(tipo)) {
    return Response.json({ error: `Tipo de sugerencia desconocido: ${tipo}` }, { status: 400 });
  }
  await rechazarSugerencia({ hoja, clave, tipo, valor: valor ?? '' });
  return Response.json({ ok: true });
}
