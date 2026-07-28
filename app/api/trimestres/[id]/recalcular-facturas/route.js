const { reprocesarFacturas } = require('../../../../../lib/facturaMatcher.cjs');

export const maxDuration = 60;

export async function POST(request, { params }) {
  const { id } = await params;
  const resultado = await reprocesarFacturas(id);
  return Response.json(resultado);
}
