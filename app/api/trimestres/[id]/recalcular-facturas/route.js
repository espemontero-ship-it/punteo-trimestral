const { listarFacturasSinResolver } = require('../../../../../lib/facturaMatcher.cjs');

export async function GET(request, { params }) {
  const { id } = await params;
  const ids = await listarFacturasSinResolver(id);
  return Response.json({ ids });
}
