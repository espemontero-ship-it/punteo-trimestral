const { listarPagosCandidatosParaMovimiento } = require('../../../../../lib/larpmanager.cjs');

export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const candidatos = await listarPagosCandidatosParaMovimiento(Number(id));
    return Response.json({ candidatos });
  } catch (err) {
    return Response.json({ error: err.message || 'No se pudieron cargar los pagos.' }, { status: 500 });
  }
}
