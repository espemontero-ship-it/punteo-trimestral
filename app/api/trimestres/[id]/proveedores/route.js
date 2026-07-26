const { construirProveedores } = require('../../../../../lib/agrupador.cjs');

export async function GET(request, { params }) {
  const { id } = await params;
  const proveedores = await construirProveedores(id);
  return Response.json({ proveedores });
}
