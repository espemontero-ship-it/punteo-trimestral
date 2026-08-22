const { probarLecturaConIA } = require('../../../../../lib/facturaMatcher.cjs');

// Lee una factura con IA y devuelve lo leído. NO escribe nada y NO vuelve a
// cruzar: "leer con IA" de verdad sí lo hace, y en una factura ya emparejada
// eso puede dejarla colgando de un segundo movimiento.
export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const resultado = await probarLecturaConIA(Number(id));
    return Response.json(resultado);
  } catch (err) {
    return Response.json({ error: err.message || 'No se pudo leer.' }, { status: 500 });
  }
}
