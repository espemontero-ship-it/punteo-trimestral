const { actualizarProveedor } = require('../../../../../lib/agrupador.cjs');

export async function POST(request, { params }) {
  const { id } = await params;
  const { proveedor } = await request.json();
  await actualizarProveedor(Number(id), proveedor);
  return Response.json({ ok: true });
}
