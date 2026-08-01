const { parsearCSV, emparejarIngresosConLarpManager } = require('../../../../../lib/larpmanager.cjs');

export const maxDuration = 60;

export async function POST(request, { params }) {
  const { id } = await params;
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    if (!file) return Response.json({ error: 'Falta el archivo CSV.' }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const filas = parsearCSV(buffer);
    if (filas.length === 0) {
      return Response.json({ error: 'No se ha encontrado ningún pago por transferencia (Wire) en el CSV.' }, { status: 400 });
    }

    const resultados = await emparejarIngresosConLarpManager(id, filas);
    const emparejadas = resultados.filter(r => r.tipo === 'match').length;
    return Response.json({ resultados, totalFilasCsv: filas.length, emparejadas });
  } catch (err) {
    return Response.json({ error: err.message || 'No se pudo procesar el CSV.' }, { status: 500 });
  }
}
