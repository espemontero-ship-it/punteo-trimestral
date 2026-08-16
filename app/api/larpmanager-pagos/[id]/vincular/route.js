const { vincularPagoAMano } = require('../../../../../lib/larpmanager.cjs');

// Vincular a mano un pago de LarpManager con su línea del banco, para los
// casos que el cruce automático no puede resolver nunca (el banco no siempre
// escribe el nombre en el concepto).
export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const { movimientoId } = await request.json();
    if (!movimientoId) return Response.json({ error: 'Falta la línea del banco.' }, { status: 400 });
    const resultado = await vincularPagoAMano(Number(id), Number(movimientoId));
    return Response.json(resultado);
  } catch (err) {
    return Response.json({ error: err.message || 'No se pudo vincular.' }, { status: 500 });
  }
}
