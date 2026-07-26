const { obtenerSesion } = require('../../../../../lib/auth.cjs');
const { obtenerLote, listarFacturasDeLote, calcularTotales } = require('../../../../../lib/lotes.cjs');

export async function GET(request, { params }) {
  const sesion = await obtenerSesion(request);
  if (!sesion || sesion.rol !== 'colaborador') return Response.json({ error: 'No autorizado' }, { status: 403 });

  const { id } = await params;
  const lote = await obtenerLote(id);
  if (!lote || lote.colaborador_id !== sesion.colaboradorId) {
    return Response.json({ error: 'No encontrado' }, { status: 404 });
  }

  const [facturas, totales] = await Promise.all([listarFacturasDeLote(id), calcularTotales(id)]);
  return Response.json({ lote, facturas, totales });
}
