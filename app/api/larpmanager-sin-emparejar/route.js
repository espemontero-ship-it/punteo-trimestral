const { listarPagosLarpManagerSinEmparejar, listarLineasConMasDeUnPago } = require('../../../lib/larpmanager.cjs');

export async function GET() {
  const pagos = await listarPagosLarpManagerSinEmparejar();
  const lineasConDosPagos = await listarLineasConMasDeUnPago();
  return Response.json({ pagos, lineasConDosPagos });
}
