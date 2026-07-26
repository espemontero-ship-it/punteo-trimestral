const { query } = require('../../../../../lib/db.cjs');
const { descargarBlob } = require('../../../../../lib/blob.cjs');

export async function GET(request, { params }) {
  const { id } = await params;
  const { rows } = await query(`SELECT ruta_blob, nombre_original FROM facturas WHERE id = $1`, [id]);
  if (rows.length === 0) return Response.json({ error: 'No encontrada' }, { status: 404 });

  const { ruta_blob: rutaBlob, nombre_original: nombre } = rows[0];
  const buffer = await descargarBlob(rutaBlob);
  const esPdf = /\.pdf($|\?)/i.test(nombre || rutaBlob);

  return new Response(buffer, {
    headers: {
      'Content-Type': esPdf ? 'application/pdf' : 'image/jpeg',
      'Content-Disposition': `inline; filename="${nombre || 'factura'}"`,
      'Cache-Control': 'private, max-age=3600',
    },
  });
}
