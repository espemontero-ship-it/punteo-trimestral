const { rechazarSugerenciaLarpManager } = require('../../../../../lib/larpmanager.cjs');

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
