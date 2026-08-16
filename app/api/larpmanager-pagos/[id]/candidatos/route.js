const { listarCandidatosParaPago } = require('../../../../../lib/larpmanager.cjs');

// Líneas del banco entre las que elegir al vincular un pago a mano.
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const candidatos = await listarCandidatosParaPago(Number(id));
    return Response.json({ candidatos });
  } catch (err) {
    return Response.json({ error: err.message || 'No se pudieron cargar las líneas.' }, { status: 500 });
  }
}
