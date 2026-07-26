const { obtenerSesion } = require('../../../../lib/auth.cjs');
const { listarLotesPorColaborador } = require('../../../../lib/lotes.cjs');

export async function GET(request) {
  const sesion = await obtenerSesion(request);
  if (!sesion || sesion.rol !== 'colaborador') return Response.json({ error: 'No autorizado' }, { status: 403 });

  const lotes = await listarLotesPorColaborador(sesion.colaboradorId);
  return Response.json({ lotes, nombre: sesion.nombre });
}
