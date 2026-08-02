const { listarDevolucionesProyecto } = require('../../../../../lib/devoluciones.cjs');

export async function GET(request, { params }) {
  const { id } = await params;
  const devoluciones = await listarDevolucionesProyecto(Number(id));
  return Response.json({ devoluciones });
}
