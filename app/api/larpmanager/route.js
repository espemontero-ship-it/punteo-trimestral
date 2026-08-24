const { put } = require('@vercel/blob');
const { query } = require('../../../lib/db.cjs');
const { parsearArchivoLarpManager, emparejarIngresosConLarpManager, asegurarTablaPagosLarpManager } = require('../../../lib/larpmanager.cjs');

export const maxDuration = 60;

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    if (!file) return Response.json({ error: 'Falta el archivo.' }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const filas = await parsearArchivoLarpManager(buffer, file.name || '');
    if (filas.length === 0) {
      return Response.json({ error: 'El archivo no tiene ninguna fila.' }, { status: 400 });
    }
    const aCruzar = filas.filter(f => f.entraEnCruce).length;
    if (aCruzar === 0) {
      return Response.json({ error: 'Ninguna fila del archivo se puede cruzar con el banco (todas son de pasarela o apuntes internos).' }, { status: 400 });
    }

    await asegurarTablaPagosLarpManager();

    const blob = await put(`larpmanager/${Date.now()}-${file.name || 'pagos.csv'}`, buffer, {
      access: 'private',
      contentType: 'text/csv',
    });
    const { rows } = await query(
      `INSERT INTO importaciones (hoja, origen, ruta_blob, nombre_archivo) VALUES ('larpmanager','larpmanager',$1,$2) RETURNING id`,
      [blob.url, file.name || null]
    );
    const importacionId = rows[0].id;

    const resultados = await emparejarIngresosConLarpManager(filas, importacionId);

    const emparejadas = resultados.filter(r => r.tipo === 'match' || r.tipo === 'match_ya_resuelta').length;
    return Response.json({
      resultados,
      totalFilasCsv: filas.length,
      filasCruzadas: aCruzar,
      filasGuardadasSinCruzar: filas.length - aCruzar,
      emparejadas,
    });
  } catch (err) {
    return Response.json({ error: err.message || 'No se pudo procesar el CSV.' }, { status: 500 });
  }
}
