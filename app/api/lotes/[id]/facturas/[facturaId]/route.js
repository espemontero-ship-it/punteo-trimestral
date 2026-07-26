const { actualizarFactura, eliminarFactura } = require('../../../../../../lib/lotes.cjs');

export async function PATCH(request, { params }) {
  const { facturaId } = await params;
  const { concepto, importe, estadoRevision, motivoRechazo } = await request.json();
  await actualizarFactura(facturaId, { concepto, importe, estadoRevision, motivoRechazo });
  return Response.json({ ok: true });
}

export async function DELETE(request, { params }) {
  const { facturaId } = await params;
  await eliminarFactura(facturaId);
  return Response.json({ ok: true });
}
