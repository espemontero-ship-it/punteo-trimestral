const { parsearCSV, emparejarIngresosConLarpManager } = require('../../../lib/larpmanager.cjs');

export const maxDuration = 60;

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    if (!file) return Response.json({ error: 'Falta el archivo CSV.' }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const filas = parsearCSV(buffer);
    if (filas.length === 0) {
      return Response.json({ error: 'No se ha encontrado ningún pago por transferencia (Wire) en el CSV.' }, { status: 400 });
    }

    const resultados = await emparejarIngresosConLarpManager(filas);
    // 'match_ya_resuelta' son líneas que ya estaban punteadas a mano y a las
    // que solo les faltaba el enlace: cuentan como emparejadas igual, si no
    // el mensaje diría que no se ha emparejado nada cuando sí se ha hecho.
    const emparejadas = resultados.filter(r => r.tipo === 'match' || r.tipo === 'match_ya_resuelta').length;
    return Response.json({ resultados, totalFilasCsv: filas.length, emparejadas });
  } catch (err) {
    return Response.json({ error: err.message || 'No se pudo procesar el CSV.' }, { status: 500 });
  }
}
