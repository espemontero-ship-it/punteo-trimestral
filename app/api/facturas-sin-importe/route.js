const { listarFacturasSinImporte } = require('../../../lib/facturaMatcher.cjs');

export async function GET() {
  const ids = await listarFacturasSinImporte();
  return Response.json({ ids });
}
