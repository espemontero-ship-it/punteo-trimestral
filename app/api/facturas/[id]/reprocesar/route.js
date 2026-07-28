const { reprocesarFactura } = require('../../../../../lib/facturaMatcher.cjs');

export const maxDuration = 30;

export async function POST(request, { params }) {
  const { id } = await params;
  try {
    const resultado = await reprocesarFactura(Number(id));
    return Response.json(resultado);
  } catch (err) {
    return Response.json({ tipo: 'error', detalle: err.message });
  }
}
