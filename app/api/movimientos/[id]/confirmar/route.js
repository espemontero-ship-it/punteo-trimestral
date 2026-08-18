const { confirmarLinea } = require('../../../../../lib/agrupador.cjs');
const { confirmarMatch } = require('../../../../../lib/facturaMatcher.cjs');

export async function POST(request, { params }) {
  const { id } = await params;
  const { nota, facturaIds } = await request.json();

  if (Array.isArray(facturaIds) && facturaIds.length) {
    // La nota no se exige. Se exigía solo en esta rama --la de confirmar CON
    // factura-- y era al revés de como tiene sentido: cuando hay factura
    // adjunta hay más información que sin ella, no menos (el PDF va en el zip
    // de la gestoría y su número sale en la columna Factura). Además dejaba
    // sin salida a una factura sin concepto: la nota se saca del concepto de
    // la factura, y con una sugerencia pendiente ese campo no se puede
    // escribir.
    await confirmarMatch(Number(id), facturaIds, nota);
  } else {
    // La nota es opcional al marcar una línea como resuelta a mano.
    await confirmarLinea(Number(id), nota);
  }

  return Response.json({ ok: true });
}
