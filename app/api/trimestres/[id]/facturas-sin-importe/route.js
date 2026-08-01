const { listarFacturasSinImporte } = require('../../../../../lib/facturaMatcher.cjs');

export async function GET(request, { params }) {
  const { id } = await params;
  const ids = await listarFacturasSinImporte(id);
  return Response.json({ ids });
}
