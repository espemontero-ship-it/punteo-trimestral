const { recalcularClaves } = require('../../../lib/importarExcel.cjs');

export async function POST() {
  const resultado = await recalcularClaves();
  return Response.json(resultado);
}
