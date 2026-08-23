const { confirmarImporteManual } = require('../../../../../lib/facturaMatcher.cjs');

export async function POST(request, { params }) {
  const { id } = await params;
  const { importe } = await request.json();

  const valor = Number(importe);
  // Se admite el negativo: una factura rectificativa es un abono. Lo unico que
  // no vale es cero ni algo que no sea un numero.
  if (importe === undefined || importe === null || importe === '' || isNaN(valor) || valor === 0) {
    return Response.json({ error: 'Importe inválido.' }, { status: 400 });
  }

  const resultado = await confirmarImporteManual(Number(id), valor);
  return Response.json(resultado);
}
