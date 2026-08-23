const { obtenerSesion } = require('../../../../lib/auth.cjs');
const { obtenerColaborador } = require('../../../../lib/colaboradores.cjs');
const { descargarBlob } = require('../../../../lib/blob.cjs');
const { analizarFactura } = require('../../../../lib/facturaMatcher.cjs');
const { procesarFacturaSubida } = require('../../../../lib/facturaMatcher.cjs');
const { buscarOCrearLote, subirFacturaLote } = require('../../../../lib/lotes.cjs');

// Punto de entrada único para que un colaborador suba una factura eligiendo
// proyecto libremente (ya no se le asigna uno fijo al alta). "Paga NOL" solo
// está disponible con el permiso puede_subir_facturas_generales; "pago yo" lo
// puede usar cualquier colaborador -- entra por su lote de ese proyecto (se
// crea al vuelo si no existía, ver buscarOCrearLote).
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
    // Se lee SIEMPRE, pague quien pague: el colaborador tambien ve el importe,
    // el proveedor y la fecha de lo que sube.
    const buffer = await descargarBlob(rutaBlob);
    const esPdf = /\.pdf($|\?)/i.test(nombreOriginal || rutaBlob) || rutaBlob.toLowerCase().includes('.pdf');
    const analisis = await analizarFactura(buffer, esPdf, nombreOriginal);

    // Paga el propio colaborador: va a su lote de ese proyecto (se crea si no
    // existe) y NO se cruza con el banco -- ese gasto no sale de la cuenta de
    // NOL, de ahi sale el reembolso que se le hace.
    if (quienPaga === 'colaborador') {
      const loteId = await buscarOCrearLote(sesion.colaboradorId, proyectoId);
      const resultado = await subirFacturaLote({ loteId, rutaBlob, nombreOriginal, concepto, analisis });
      return Response.json({ tipo: 'lote', ...resultado });
    }

    // Paga NOL: flujo normal, se le buscan lineas del banco.
    const resultado = await procesarFacturaSubida({
      rutaBlob, nombreOriginal, concepto, analisis, subidoPor: sesion.colaboradorId, proyectoId,
    });
    return Response.json(resultado);
  } catch (err) {
    return Response.json({ tipo: 'error', detalle: `Fallo al procesar el archivo: ${err.message}` });
  }
}
