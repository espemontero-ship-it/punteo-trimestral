const { obtenerLote, listarFacturasDeLote, calcularTotales } = require('../../../../lib/lotes.cjs');
const { listarPagosDeLote } = require('../../../../lib/pagos.cjs');

export async function GET(request, { params }) {
  const { id } = await params;
  const lote = await obtenerLote(id);
  if (!lote) return Response.json({ error: 'Lote no encontrado.' }, { status: 404 });

  const [facturas, pagos, totales] = await Promise.all([
    listarFacturasDeLote(id),
    listarPagosDeLote(id),
    calcularTotales(id),
  ]);

  return Response.json({ lote, facturas, pagos, totales });
}
