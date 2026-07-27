const { actualizarProveedorGrupo } = require('../../../../../../lib/agrupador.cjs');

export async function POST(request, { params }) {
  const { id } = await params;
  const { hoja, clave, proveedor } = await request.json();
  if (!hoja || !clave) {
    return Response.json({ error: 'Faltan datos (hoja, clave).' }, { status: 400 });
  }
  await actualizarProveedorGrupo(id, hoja, clave, proveedor);
  return Response.json({ ok: true });
}
