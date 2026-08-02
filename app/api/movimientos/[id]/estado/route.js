const { marcarLineaEstado } = require('../../../../../lib/agrupador.cjs');

export async function POST(request, { params }) {
  const { id } = await params;
  const { estado } = await request.json();
  if (!['pendiente', 'pedida', 'factura_futura', 'ignorar'].includes(estado)) {
    return Response.json({ error: 'Estado no válido.' }, { status: 400 });
  }
  await marcarLineaEstado(Number(id), estado);
  return Response.json({ ok: true });
}
