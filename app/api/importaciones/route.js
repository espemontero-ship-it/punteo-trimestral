const { listarImportaciones } = require('../../../lib/importarExcel.cjs');

export async function GET() {
  const importaciones = await listarImportaciones();
  return Response.json({ importaciones });
}
