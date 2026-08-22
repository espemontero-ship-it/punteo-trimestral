const { listarFacturasIncompletas } = require('../../../lib/facturaMatcher.cjs');

// Ids de las facturas a las que les falta la huella del archivo o el
// proveedor, para que la pantalla las recorra una a una con progreso.
export async function GET() {
  const ids = await listarFacturasIncompletas();
  return Response.json({ ids });
}
