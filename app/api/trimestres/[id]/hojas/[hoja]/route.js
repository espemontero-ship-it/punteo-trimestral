const { borrarHoja } = require('../../../../../../lib/importarExcel.cjs');

export async function DELETE(request, { params }) {
  const { id, hoja } = await params;
  await borrarHoja(id, hoja);
  return Response.json({ ok: true });
}
