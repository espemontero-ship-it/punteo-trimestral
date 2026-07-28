const { descargarBlob } = require('../../../lib/blob.cjs');
const { analizarBuffer } = require('../../../lib/facturas.cjs');
const { procesarFacturaSubida } = require('../../../lib/facturaMatcher.cjs');

// Analizar un PDF (descarga + pdf-parse) puede tardar más de los 10s por
// defecto de una función serverless, sobre todo con archivos escaneados o
// grandes — con la subida en lote, decenas de archivos seguidos hacían que
// algunos fallaran por tiempo. Se sube el límite explícitamente.
export const maxDuration = 60;

export async function POST(request) {
  const { trimestreId, hoja, clave, rutaBlob, nombreOriginal, concepto, importe, fecha } = await request.json();
  if (!trimestreId || !rutaBlob) {
    return Response.json({ error: 'Faltan datos (trimestreId, rutaBlob).' }, { status: 400 });
  }

  // Nunca dejar que un fallo aquí devuelva una respuesta vacía o HTML de
  // error — la subida en lote necesita JSON siempre, incluso al fallar, para
  // poder mostrar por qué falló esa factura en concreto en vez de un
  // "Unexpected end of JSON input" genérico sin información real.
  try {
    const buffer = await descargarBlob(rutaBlob);
    const esPdf = /\.pdf($|\?)/i.test(nombreOriginal || rutaBlob) || rutaBlob.toLowerCase().includes('.pdf');
    const analisis = await analizarBuffer(buffer, esPdf);

    // Si quien sube la factura ya sabe el importe/fecha (a mano, cuando no
    // se puede leer del PDF), esos datos mandan sobre lo que haya extraído
    // el regex — evita depender de la lectura automática para poder emparejar.
    const importeManual = importe ? Number(importe) : null;
    if (importeManual) {
      analisis.totales = [importeManual];
      analisis.importes = [importeManual];
    }
    if (fecha) analisis.fechas = [new Date(fecha), ...analisis.fechas];

    const resultado = await procesarFacturaSubida({
      trimestreId, hoja, clave, rutaBlob, nombreOriginal, concepto, analisis,
    });

    return Response.json(resultado);
  } catch (err) {
    return Response.json({ tipo: 'error', detalle: `Fallo al procesar el archivo: ${err.message}` });
  }
}
