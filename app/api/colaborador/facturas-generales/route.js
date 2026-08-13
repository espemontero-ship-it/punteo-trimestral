const { obtenerSesion } = require('../../../../lib/auth.cjs');
const { obtenerColaborador } = require('../../../../lib/colaboradores.cjs');
const { descargarBlob } = require('../../../../lib/blob.cjs');
const { analizarBuffer } = require('../../../../lib/facturas.cjs');
const { procesarFacturaSubida } = require('../../../../lib/facturaMatcher.cjs');
const { buscarOCrearLote, subirFacturaLote, trimestreActual } = require('../../../../lib/lotes.cjs');

// Mismo motor que `POST /api/facturas` (subida de facturas generales, no
// ligadas a ningún lote), pero en una ruta propia solo para colaboradores con
// el permiso puede_subir_facturas_generales -- así esta cuenta nunca puede
// llegar al GET/DELETE de `/api/facturas`, que listan/borran TODAS las
// facturas de la empresa.
export const maxDuration = 60;

export async function POST(request) {
  const sesion = await obtenerSesion(request);
  if (!sesion || sesion.rol !== 'colaborador') return Response.json({ error: 'No autorizado' }, { status: 403 });

  const colaborador = await obtenerColaborador(sesion.colaboradorId);
  if (!colaborador || !colaborador.puede_subir_facturas_generales) {
    return Response.json({ error: 'No tienes permiso para subir facturas de NOL.' }, { status: 403 });
  }

  const { rutaBlob, nombreOriginal, concepto, importe, fecha, proyectoId, quienPaga } = await request.json();
  if (!rutaBlob) return Response.json({ error: 'Faltan datos (rutaBlob).' }, { status: 400 });
  if (!proyectoId) return Response.json({ error: 'Falta el proyecto.' }, { status: 400 });
  if (quienPaga !== 'colaborador' && quienPaga !== 'nol') {
    return Response.json({ error: 'Falta indicar quién paga.' }, { status: 400 });
  }

  try {
    // Paga el propio colaborador: es una factura normal de su lote de ese
    // proyecto (se crea el lote si todavía no existe), no una general de NOL.
    if (quienPaga === 'colaborador') {
      const loteId = await buscarOCrearLote(sesion.colaboradorId, proyectoId);
      const resultado = await subirFacturaLote({
        loteId, trimestreId: trimestreActual(), rutaBlob, nombreOriginal, concepto,
        importe: importe ? Number(importe) : null, fecha: fecha || null, esImagen: !/\.pdf($|\?)/i.test(nombreOriginal || rutaBlob),
      });
      return Response.json({ tipo: 'lote', ...resultado });
    }

    // Paga NOL directamente: sigue el motor de facturas generales (intenta
    // emparejar con el movimiento del banco real de NOL), pero ahora con el
    // proyecto indicado a mano en vez de sin ninguno.
    const buffer = await descargarBlob(rutaBlob);
    const esPdf = /\.pdf($|\?)/i.test(nombreOriginal || rutaBlob) || rutaBlob.toLowerCase().includes('.pdf');
    const analisis = await analizarBuffer(buffer, esPdf);

    const importeManual = importe ? Number(importe) : null;
    if (importeManual) {
      analisis.totales = [importeManual];
      analisis.importes = [importeManual];
    }
    if (fecha) analisis.fechas = [new Date(fecha), ...analisis.fechas];

    const resultado = await procesarFacturaSubida({ rutaBlob, nombreOriginal, concepto, analisis, subidoPor: sesion.colaboradorId, proyectoId });
    return Response.json(resultado);
  } catch (err) {
    return Response.json({ tipo: 'error', detalle: `Fallo al procesar el archivo: ${err.message}` });
  }
}
