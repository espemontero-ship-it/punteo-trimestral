const { obtenerSesion } = require('../../../../lib/auth.cjs');
const { obtenerColaborador } = require('../../../../lib/colaboradores.cjs');
const { descargarBlob } = require('../../../../lib/blob.cjs');
const { analizarFactura } = require('../../../../lib/facturaMatcher.cjs');
const { procesarFacturaSubida } = require('../../../../lib/facturaMatcher.cjs');
const { buscarOCrearLote, subirFacturaLote } = require('../../../../lib/lotes.cjs');

export const maxDuration = 60;

export async function POST(request) {
  const sesion = await obtenerSesion(request);
  if (!sesion || sesion.rol !== 'colaborador') return Response.json({ error: 'No autorizado' }, { status: 403 });

  const { rutaBlob, nombreOriginal, concepto, importe, fecha, proyectoId, quienPaga } = await request.json();
  if (!rutaBlob) return Response.json({ error: 'Faltan datos (rutaBlob).' }, { status: 400 });
  if (!proyectoId) return Response.json({ error: 'Falta el proyecto.' }, { status: 400 });
  if (quienPaga !== 'colaborador' && quienPaga !== 'nol') {
    return Response.json({ error: 'Falta indicar quién paga.' }, { status: 400 });
  }
  if (quienPaga === 'nol') {
    const colaborador = await obtenerColaborador(sesion.colaboradorId);
    if (!colaborador || !colaborador.puede_subir_facturas_generales) {
      return Response.json({ error: 'No tienes permiso para subir facturas de NOL.' }, { status: 403 });
    }
  }

  try {

    const buffer = await descargarBlob(rutaBlob);
    const esPdf = /\.pdf($|\?)/i.test(nombreOriginal || rutaBlob) || rutaBlob.toLowerCase().includes('.pdf');
    const analisis = await analizarFactura(buffer, esPdf, nombreOriginal);

    if (quienPaga === 'colaborador') {
      const loteId = await buscarOCrearLote(sesion.colaboradorId, proyectoId);
      const resultado = await subirFacturaLote({ loteId, rutaBlob, nombreOriginal, concepto, analisis });
      return Response.json({ tipo: 'lote', ...resultado });
    }

    const resultado = await procesarFacturaSubida({
      rutaBlob, nombreOriginal, concepto, analisis, subidoPor: sesion.colaboradorId, proyectoId,
    });
    return Response.json(resultado);
  } catch (err) {
    return Response.json({ tipo: 'error', detalle: `Fallo al procesar el archivo: ${err.message}` });
  }
}
