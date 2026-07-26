const { descargarBlob } = require('../../../lib/blob.cjs');
const { analizarBuffer } = require('../../../lib/facturas.cjs');
const { procesarFacturaSubida } = require('../../../lib/facturaMatcher.cjs');

export async function POST(request) {
  const { trimestreId, hoja, clave, rutaBlob, nombreOriginal } = await request.json();
  if (!trimestreId || !hoja || !clave || !rutaBlob) {
    return Response.json({ error: 'Faltan datos (trimestreId, hoja, clave, rutaBlob).' }, { status: 400 });
  }

  const buffer = await descargarBlob(rutaBlob);
  const esPdf = /\.pdf($|\?)/i.test(nombreOriginal || rutaBlob) || rutaBlob.toLowerCase().includes('.pdf');
  const analisis = await analizarBuffer(buffer, esPdf);

  const resultado = await procesarFacturaSubida({
    trimestreId, hoja, clave, rutaBlob, nombreOriginal, analisis,
  });

  return Response.json(resultado);
}
