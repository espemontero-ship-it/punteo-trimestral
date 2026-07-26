const { marcarGrupoPendiente } = require('../../../../../../lib/agrupador.cjs');

export async function POST(request, { params }) {
  const { id } = await params;
  const { hoja, clave } = await request.json();
  if (!hoja || !clave) return Response.json({ error: 'Faltan datos (hoja, clave).' }, { status: 400 });
  const lineas = await marcarGrupoPendiente(id, hoja, clave);
  return Response.json({ ok: true, lineas });
}
