const { listarCandidatosParaPago, historialDeJugador } = require('../../../../../lib/larpmanager.cjs');

export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const [candidatos, historial] = await Promise.all([
      listarCandidatosParaPago(Number(id)),
      historialDeJugador(Number(id)),
    ]);
    return Response.json({ candidatos, historial });
  } catch (err) {
    return Response.json({ error: err.message || 'No se pudieron cargar las líneas.' }, { status: 500 });
  }
}
