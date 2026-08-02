const { listarPagosLarpManagerSinEmparejar } = require('../../../../../lib/larpmanager.cjs');

export async function GET(request, { params }) {
  const { id } = await params;
  const pagos = await listarPagosLarpManagerSinEmparejar(id);
  return Response.json({ pagos });
}
