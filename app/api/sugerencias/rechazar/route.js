const { rechazarSugerencia } = require('../../../../lib/agrupador.cjs');

// La ✕ de una sugerencia. `tipo` es nota | proveedor | proyecto | devolucion |
// jugador; `valor` es lo que se rechaza (el nombre del proyecto, el del
// proveedor...), vacío en las que no tienen valor.
// LarpManager no pasa por aquí a propósito: sus propuestas son candidatos
// concretos de un pago, no una regla del tipo de movimiento.
const TIPOS = ['nota', 'proveedor', 'proyecto', 'devolucion', 'jugador'];

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
