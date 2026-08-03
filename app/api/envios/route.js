const { previsualizarEnvio, confirmarEnvio } = require('../../../lib/exportar.cjs');

// ?hasta=YYYY-MM-DD -- qué entraría si se confirmara el envío ahora mismo,
// para revisar antes de generar de verdad.
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const hasta = searchParams.get('hasta');
  if (!hasta) return Response.json({ error: 'Falta la fecha hasta la que generar el envío.' }, { status: 400 });
  const resumen = await previsualizarEnvio(hasta);
  return Response.json(resumen);
}

export async function POST(request) {
  const { hasta, etiqueta, desde } = await request.json();
  if (!hasta) return Response.json({ error: 'Falta la fecha hasta la que generar el envío.' }, { status: 400 });

  let zipBuffer;
  try {
    zipBuffer = await confirmarEnvio({ hasta, etiqueta, desde });
  } catch (err) {
    console.error('Error generando envío a gestoría', err);
    return Response.json({ error: err.message || 'No se pudo generar el envío.' }, { status: 500 });
  }

  const nombreArchivo = etiqueta ? etiqueta.replace(/[^a-z0-9]+/gi, '-') : `envio-${hasta}`;
  return new Response(zipBuffer, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${nombreArchivo}.zip"`,
    },
  });
}
