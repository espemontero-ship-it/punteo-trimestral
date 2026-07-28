const { actualizarFactura, eliminarFactura } = require('../../../../../../lib/lotes.cjs');

export async function PATCH(request, { params }) {
  const { facturaId } = await params;
  const { concepto, importe, fecha, estadoRevision, motivoRechazo } = await request.json();
  await actualizarFactura(facturaId, { concepto, importe, fecha, estadoRevision, motivoRechazo });
  return Response.json({ ok: true });
}

export async function DELETE(request, { params }) {
  const { facturaId } = await params;
  await eliminarFactura(facturaId);
  return Response.json({ ok: true });
}
