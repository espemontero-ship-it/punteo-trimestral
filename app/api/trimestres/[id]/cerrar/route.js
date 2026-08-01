const { generarPaqueteTrimestre } = require('../../../../../lib/exportar.cjs');

export async function GET(request, { params }) {
  const { id } = await params;
  let zipBuffer;
  try {
    zipBuffer = await generarPaqueteTrimestre(id);
  } catch (err) {
    console.error('Error cerrando trimestre', id, err);
    return Response.json({ error: err.message || 'No se pudo generar el paquete del trimestre.' }, { status: 500 });
  }

  return new Response(zipBuffer, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="punteo-${id}.zip"`,
    },
  });
}
