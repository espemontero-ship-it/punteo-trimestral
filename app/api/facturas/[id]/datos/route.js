const { confirmarDatosManual } = require('../../../../../lib/facturaMatcher.cjs');

export async function POST(request, { params }) {
  const { id } = await params;
  const { importe, fecha, concepto } = await request.json();

  if (importe !== undefined && importe !== null && importe !== '') {
    const valor = Number(importe);
    if (isNaN(valor) || valor <= 0) return Response.json({ error: 'Importe inválido.' }, { status: 400 });
  }

  const resultado = await confirmarDatosManual(Number(id), {
    importe: importe ? Number(importe) : null,
    fecha: fecha || null,
    concepto: concepto || null,
  });
  return Response.json(resultado);
}
