const { obtenerSesion } = require('../../../../../../lib/auth.cjs');
const { obtenerLote, subirFacturaLote } = require('../../../../../../lib/lotes.cjs');

export async function POST(request, { params }) {
  const sesion = await obtenerSesion(request);
  if (!sesion || sesion.rol !== 'colaborador') return Response.json({ error: 'No autorizado' }, { status: 403 });

  const { id } = await params;
  const lote = await obtenerLote(id);
  if (!lote || lote.colaborador_id !== sesion.colaboradorId) {
    return Response.json({ error: 'No encontrado' }, { status: 404 });
  }

  const { rutaBlob, nombreOriginal, concepto, importe } = await request.json();
  if (!rutaBlob) return Response.json({ error: 'Falta rutaBlob.' }, { status: 400 });

  const esImagen = !/\.pdf($|\?)/i.test(nombreOriginal || rutaBlob);
  const factura = await subirFacturaLote({
    loteId: id, trimestreId: lote.trimestre_id, rutaBlob, nombreOriginal,
    concepto, importe: importe ? Number(importe) : null, esImagen,
  });

  return Response.json({ ok: true, factura });
}
