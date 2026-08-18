const { rechazarSugerenciaLarpManager } = require('../../../../../lib/larpmanager.cjs');

// La ✕ de la sugerencia. Se guarda el par pago-movimiento para siempre: decir
// que no a una propuesta no es "ahora no", es "ese movimiento no es de esta
// persona". El reparto sigue buscando, así que rechazar hace que salga la
// siguiente mejor en vez de dejar el pago sin nada.
export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const { movimientoId } = await request.json();
    if (!movimientoId) return Response.json({ error: 'Falta el movimiento.' }, { status: 400 });
    const resultado = await rechazarSugerenciaLarpManager(Number(id), Number(movimientoId));
    return Response.json(resultado);
  } catch (err) {
    return Response.json({ error: err.message || 'No se pudo rechazar.' }, { status: 500 });
  }
}
