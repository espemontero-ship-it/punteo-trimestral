const { obtenerSesion } = require('../../../../../lib/auth.cjs');
const { obtenerLote, listarFacturasDeLote, calcularTotales } = require('../../../../../lib/lotes.cjs');
const { listarPagosDeLote } = require('../../../../../lib/pagos.cjs');

export async function GET(request, { params }) {
  const sesion = await obtenerSesion(request);
  if (!sesion || sesion.rol !== 'colaborador') return Response.json({ error: 'No autorizado' }, { status: 403 });

  const { id } = await params;
  const lote = await obtenerLote(id);
  if (!lote || lote.colaborador_id !== sesion.colaboradorId) {
    return Response.json({ error: 'No encontrado' }, { status: 404 });
  }

  const [facturas, pagos, totales] = await Promise.all([
    listarFacturasDeLote(id),
    listarPagosDeLote(id),
    calcularTotales(id),
  ]);
  return Response.json({ lote, facturas, pagos, totales });
}
