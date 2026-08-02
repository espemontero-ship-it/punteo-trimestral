const { listarHojas } = require('../../../../../lib/importarExcel.cjs');

export async function GET(request, { params }) {
  const { id } = await params;
  const hojas = await listarHojas(id);
  return Response.json({ hojas });
}
