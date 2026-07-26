const { generarPaqueteTrimestre } = require('../../../../../lib/exportar.cjs');

export async function GET(request, { params }) {
  const { id } = await params;
  const zipBuffer = await generarPaqueteTrimestre(id);

  return new Response(zipBuffer, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="punteo-${id}.zip"`,
    },
  });
}
