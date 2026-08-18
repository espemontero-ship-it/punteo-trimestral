const { listarPagosCandidatosParaMovimiento } = require('../../../../../lib/larpmanager.cjs');

// Pagos de LarpManager que podrían ser de este movimiento, para poder
// enlazarlos desde la pestaña Movimientos. Es el camino inverso al de la
// pestaña LarpManager, donde se elige el movimiento de un pago.
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const candidatos = await listarPagosCandidatosParaMovimiento(Number(id));
    return Response.json({ candidatos });
  } catch (err) {
    return Response.json({ error: err.message || 'No se pudieron cargar los pagos.' }, { status: 500 });
  }
}
