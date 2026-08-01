const { reprocesarFacturaConIA } = require('../../../../../lib/facturaMatcher.cjs');

export const maxDuration = 60;

export async function POST(request, { params }) {
  const { id } = await params;
  try {
    const resultado = await reprocesarFacturaConIA(Number(id));
    return Response.json(resultado);
  } catch (err) {
    return Response.json({ tipo: 'error', detalle: err.message });
  }
}
