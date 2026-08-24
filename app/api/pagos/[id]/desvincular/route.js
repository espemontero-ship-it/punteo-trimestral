const { desvincularPago } = require('../../../../../lib/pagos.cjs');

export async function POST(request, { params }) {
  const { id } = await params;
  try {
    const resultado = await desvincularPago(id);
    return Response.json({ ok: true, ...resultado });
  } catch (err) {
    return Response.json({ error: err.message }, { status: err.status || 500 });
  }
}
