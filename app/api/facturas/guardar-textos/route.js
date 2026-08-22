const { guardarTextosFaltantes } = require('../../../../lib/facturaMatcher.cjs');

// Rellena el texto leído del PDF en las facturas que se subieron antes de que
// se guardara. Solo escribe esa columna: no vuelve a cruzar nada, porque
// reprocesar una factura ya emparejada la haría buscar otra línea del banco.
//
// Vive como endpoint porque los archivos están en Vercel Blob, y a Blob solo
// se llega desde el servidor desplegado -- en local devuelve 403.
export async function POST() {
  try {
    const resultado = await guardarTextosFaltantes();
    return Response.json(resultado);
  } catch (err) {
    return Response.json({ error: err.message || 'No se pudieron guardar los textos.' }, { status: 500 });
  }
}
