const { confirmarGrupo } = require('../../../../lib/agrupador.cjs');

export async function POST(request) {
  const { hoja, clave, nota } = await request.json();
  if (!hoja || !clave) {
    return Response.json({ error: 'Faltan datos (hoja, clave).' }, { status: 400 });
  }
  const lineas = await confirmarGrupo(hoja, clave, nota);
  return Response.json({ ok: true, lineas });
}
