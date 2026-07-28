const { recalcularClaves } = require('../../../../../lib/importarExcel.cjs');

export async function POST(request, { params }) {
  const { id } = await params;
  const resultado = await recalcularClaves(id);
  return Response.json(resultado);
}
