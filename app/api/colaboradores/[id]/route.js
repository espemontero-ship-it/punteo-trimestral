const { actualizarEstadoColaborador, actualizarPermisoInvitar, actualizarPermisoFacturasGenerales } = require('../../../../lib/colaboradores.cjs');

export async function PATCH(request, { params }) {
  const { id } = await params;
  const { estado, puedeInvitar, puedeSubirFacturasGenerales } = await request.json();
  try {
    if (estado !== undefined) await actualizarEstadoColaborador(id, estado);
    if (puedeInvitar !== undefined) await actualizarPermisoInvitar(id, puedeInvitar);
    if (puedeSubirFacturasGenerales !== undefined) await actualizarPermisoFacturasGenerales(id, puedeSubirFacturasGenerales);
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: err.message }, { status: err.status || 500 });
  }
}
