const { listarDevolucionesTrimestre } = require('../../../../../lib/devoluciones.cjs');

export async function GET(request, { params }) {
  const { id } = await params;
  const devoluciones = await listarDevolucionesTrimestre(id);
  return Response.json({ devoluciones });
}
