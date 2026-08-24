const { desvincularPago } = require('../../../../../lib/larpmanager.cjs');

export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const resultado = await desvincularPago(Number(id));
    return Response.json(resultado);
  } catch (err) {
    return Response.json({ error: err.message || 'No se pudo desvincular.' }, { status: 500 });
  }
}
