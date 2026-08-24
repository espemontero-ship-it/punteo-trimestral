const { cambiarEstadoPago } = require('../../../../../lib/larpmanager.cjs');

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
