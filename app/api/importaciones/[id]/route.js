const { borrarImportacion } = require('../../../../lib/importarExcel.cjs');

export async function DELETE(request, { params }) {
  const { id } = await params;
  await borrarImportacion(Number(id));
  return Response.json({ ok: true });
}
