const { actualizarFactura, eliminarFactura } = require('../../../../../../lib/lotes.cjs');

export async function PATCH(request, { params }) {
  const { facturaId } = await params;
  const { concepto, importe, fecha, estadoRevision, motivoRechazo } = await request.json();
  try {
    await actualizarFactura(facturaId, { concepto, importe, fecha, estadoRevision, motivoRechazo });
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: err.message }, { status: err.status || 500 });
  }
}

export async function DELETE(request, { params }) {
  const { facturaId } = await params;
  try {
    await eliminarFactura(facturaId);
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: err.message }, { status: err.status || 500 });
  }
}
