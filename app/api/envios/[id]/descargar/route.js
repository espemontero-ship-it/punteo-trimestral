const { descargarEnvioHecho } = require('../../../../../lib/exportar.cjs');

export const maxDuration = 60;

export async function GET(request, { params }) {
  const { id } = await params;
  try {
    const { zip, nombre } = await descargarEnvioHecho(Number(id));
    return new Response(zip, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${nombre}.zip"`,
      },
    });
  } catch (err) {
    console.error('Error volviendo a generar un envío a gestoría', err);
    return Response.json({ error: err.message || 'No se pudo generar el archivo.' }, { status: err.status || 500 });
  }
}
