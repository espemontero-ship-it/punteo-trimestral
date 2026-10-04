const { descargarEnvio } = require('../../../../lib/exportar.cjs');

export const maxDuration = 60;

export async function POST(request) {
  const { hasta, etiqueta } = await request.json();
  if (!hasta) return Response.json({ error: 'Falta la fecha hasta la que generar el envío.' }, { status: 400 });

  let zipBuffer;
  try {
    zipBuffer = await descargarEnvio({ hasta, etiqueta });
  } catch (err) {
    console.error('Error generando el archivo para la gestoría', err);
    return Response.json({ error: err.message || 'No se pudo generar el archivo.' }, { status: err.status || 500 });
  }

  const nombreArchivo = etiqueta ? etiqueta.replace(/[^a-z0-9]+/gi, '-') : `envio-${hasta}`;
  return new Response(zipBuffer, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${nombreArchivo}.zip"`,
    },
  });
}
