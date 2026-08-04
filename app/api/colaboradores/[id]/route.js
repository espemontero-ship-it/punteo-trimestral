const { actualizarEstadoColaborador } = require('../../../../lib/colaboradores.cjs');

export async function PATCH(request, { params }) {
  const { id } = await params;
  const { estado } = await request.json();
  try {
    await actualizarEstadoColaborador(id, estado);
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: err.message }, { status: err.status || 500 });
  }
}
