const { listarCandidatosParaPago, historialDeJugador } = require('../../../../../lib/larpmanager.cjs');

// Lo que hace falta para decidir a mano: las líneas del banco entre las que
// elegir, y el resto de pagos de esa persona. Van juntos en una sola llamada
// porque se enseñan juntos, en el mismo panel.
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
