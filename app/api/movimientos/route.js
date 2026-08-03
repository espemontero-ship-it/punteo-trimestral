const { construirProveedores } = require('../../../lib/agrupador.cjs');

// Histórico continuo -- desde/hasta (YYYY-MM-DD) opcionales acotan por
// fecha; sin ellos, trae todo.
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const desde = searchParams.get('desde') || null;
  const hasta = searchParams.get('hasta') || null;
  const proveedores = await construirProveedores(desde, hasta);
  return Response.json({ proveedores });
}
