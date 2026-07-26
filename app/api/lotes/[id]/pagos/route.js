const { crearPago } = require('../../../../../lib/pagos.cjs');

export async function POST(request, { params }) {
  const { id } = await params;
  const { importe, fecha, nota } = await request.json();
  if (!importe) return Response.json({ error: 'Falta el importe.' }, { status: 400 });

  const pagoId = await crearPago(id, importe, fecha, nota);
  return Response.json({ ok: true, pagoId });
}
