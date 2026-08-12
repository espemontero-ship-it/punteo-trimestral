const { listarFacturasPendientesPorProyecto } = require('../../../../../lib/lotes.cjs');

export async function GET(request, { params }) {
  const { id } = await params;
  const facturas = await listarFacturasPendientesPorProyecto(Number(id));
  return Response.json({ facturas });
}
