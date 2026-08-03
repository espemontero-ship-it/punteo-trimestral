const { listarPagosLarpManagerSinEmparejar } = require('../../../lib/larpmanager.cjs');

export async function GET() {
  const pagos = await listarPagosLarpManagerSinEmparejar();
  return Response.json({ pagos });
}
