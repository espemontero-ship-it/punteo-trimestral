const { obtenerSesion } = require('../../../../../lib/auth.cjs');
const { corregirFacturaColaborador, retirarFacturaColaborador } = require('../../../../../lib/lotes.cjs');

// El colaborador corrige o retira lo que ha subido, mientras esté sin revisar.
// Quién es dueño de la factura y en qué estado está lo comprueba lib/lotes.cjs:
// aquí no se decide nada de eso.

export async function PATCH(request, { params }) {
  const sesion = await obtenerSesion(request);
  if (!sesion || sesion.rol !== 'colaborador') return Response.json({ error: 'No autorizado' }, { status: 403 });

  const { id } = await params;
  const { concepto, importe, fecha } = await request.json();

  const valor = importe === undefined || importe === null || importe === '' ? null : Number(importe);
  if (valor !== null && (isNaN(valor) || valor === 0)) {
    return Response.json({ error: 'Invalid amount.' }, { status: 400 });
  }

  try {
    await corregirFacturaColaborador(sesion.colaboradorId, Number(id), {
      concepto: concepto ?? null, importe: valor, fecha: fecha || null,
    });
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: err.message }, { status: err.status || 500 });
  }
}

export async function DELETE(request, { params }) {
  const sesion = await obtenerSesion(request);
  if (!sesion || sesion.rol !== 'colaborador') return Response.json({ error: 'No autorizado' }, { status: 403 });

  const { id } = await params;
  try {
    await retirarFacturaColaborador(sesion.colaboradorId, Number(id));
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: err.message }, { status: err.status || 500 });
  }
}
