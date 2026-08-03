const { listarDevolucionesEnRango } = require('../../../lib/devoluciones.cjs');

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const desde = searchParams.get('desde') || null;
  const hasta = searchParams.get('hasta') || null;
  const devoluciones = await listarDevolucionesEnRango(desde, hasta);
  return Response.json({ devoluciones });
}
