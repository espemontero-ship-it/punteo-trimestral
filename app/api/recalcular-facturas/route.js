const { listarFacturasSinResolver } = require('../../../lib/facturaMatcher.cjs');

export async function GET() {
  const ids = await listarFacturasSinResolver();
  return Response.json({ ids });
}
