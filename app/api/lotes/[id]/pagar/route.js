const { pagarFacturas } = require('../../../../../lib/pagos.cjs');

export async function POST(request, { params }) {
  const { id } = await params;
  const { facturaIds, fecha } = await request.json();
  try {
    const pago = await pagarFacturas(id, { facturaIds, fecha });
    return Response.json({ ok: true, pago });
  } catch (err) {
    return Response.json({ error: err.message }, { status: err.status || 500 });
  }
}
