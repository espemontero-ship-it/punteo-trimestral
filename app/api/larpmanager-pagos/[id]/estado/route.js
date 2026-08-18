const { cambiarEstadoPago } = require('../../../../../lib/larpmanager.cjs');

// Pendiente / resuelta / ignorada. Existe para poder sacar un pago de la
// lista sin borrarlo: borrarlo no servía de nada, porque una fila se
// reconoce por su firma y al volver a subir el export entraría otra vez.
export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const { estado } = await request.json();
    const resultado = await cambiarEstadoPago(Number(id), estado);
    return Response.json(resultado);
  } catch (err) {
    return Response.json({ error: err.message || 'No se pudo cambiar el estado.' }, { status: 500 });
  }
}
