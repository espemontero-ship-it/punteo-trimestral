const { put } = require('@vercel/blob');
const { query } = require('../../../lib/db.cjs');
const { parsearCSV, emparejarIngresosConLarpManager, asegurarTablaPagosLarpManager } = require('../../../lib/larpmanager.cjs');

export const maxDuration = 60;

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    if (!file) return Response.json({ error: 'Falta el archivo CSV.' }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const filas = parsearCSV(buffer);
    if (filas.length === 0) {
      return Response.json({ error: 'El CSV no tiene ninguna fila.' }, { status: 400 });
    }
    const aCruzar = filas.filter(f => f.entraEnCruce).length;
    if (aCruzar === 0) {
      return Response.json({ error: 'Ninguna fila del CSV se puede cruzar con el banco (todas son de pasarela o apuntes internos).' }, { status: 400 });
    }

    // El archivo se guarda y la subida queda registrada, igual que la del
    // excel del banco: antes el CSV se procesaba y se tiraba, y no había forma
    // de saber qué se subió, cuándo, ni de deshacerlo.
    // Antes de registrar nada: las columnas nuevas (importaciones.origen entre
    // ellas) se crean aquí, y sin ellas el registro de la subida falla.
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
    // 'match_ya_resuelta' son líneas que ya estaban punteadas a mano y a las
    // que solo les faltaba el enlace: cuentan como emparejadas igual, si no
    // el mensaje diría que no se ha emparejado nada cuando sí se ha hecho.
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
