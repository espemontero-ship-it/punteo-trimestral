const { construirProveedores } = require('../../../lib/agrupador.cjs');

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const desde = searchParams.get('desde') || null;
  const hasta = searchParams.get('hasta') || null;
  const proveedores = await construirProveedores(desde, hasta);
  return Response.json({ proveedores });
}
