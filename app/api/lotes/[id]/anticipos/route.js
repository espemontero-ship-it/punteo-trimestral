const { crearAnticipo } = require('../../../../../lib/pagos.cjs');

export async function POST(request, { params }) {
  const { id } = await params;
  const { importe, fecha, esEfectivo } = await request.json();
  try {
    const anticipoId = await crearAnticipo(id, { importe, fecha, esEfectivo });
    return Response.json({ ok: true, anticipoId });
  } catch (err) {
    return Response.json({ error: err.message }, { status: err.status || 500 });
  }
}
