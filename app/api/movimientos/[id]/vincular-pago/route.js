const { vincularPago } = require('../../../../../lib/pagos.cjs');

export async function POST(request, { params }) {
  const { id } = await params;
  const { pagoId } = await request.json();
  if (!pagoId) return Response.json({ error: 'Falta pagoId.' }, { status: 400 });
  try {
    await vincularPago(pagoId, Number(id));
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: err.message }, { status: err.status || 500 });
  }
}
