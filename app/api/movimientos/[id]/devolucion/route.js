const { marcarDevolucion } = require('../../../../../lib/devoluciones.cjs');

export async function POST(request, { params }) {
  const { id } = await params;
  const { jugador } = await request.json();
  await marcarDevolucion(Number(id), jugador);
  return Response.json({ ok: true });
}
