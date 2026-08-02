const { listarFacturasFuturasProyecto } = require('../../../../../lib/agrupador.cjs');

export async function GET(request, { params }) {
  const { id } = await params;
  const facturas = await listarFacturasFuturasProyecto(Number(id));
  return Response.json({ facturas });
}
