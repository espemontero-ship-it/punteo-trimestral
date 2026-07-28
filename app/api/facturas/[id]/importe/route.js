const { confirmarImporteManual } = require('../../../../../lib/facturaMatcher.cjs');

export async function POST(request, { params }) {
  const { id } = await params;
  const { importe } = await request.json();

  const valor = Number(importe);
  if (!importe || isNaN(valor) || valor <= 0) {
    return Response.json({ error: 'Importe inválido.' }, { status: 400 });
  }

  const resultado = await confirmarImporteManual(Number(id), valor);
  return Response.json(resultado);
}
