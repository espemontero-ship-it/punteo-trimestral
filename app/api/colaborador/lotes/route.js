const { obtenerSesion } = require('../../../../lib/auth.cjs');
const { listarLotesPorColaborador } = require('../../../../lib/lotes.cjs');
const { obtenerColaborador } = require('../../../../lib/colaboradores.cjs');

export async function GET(request) {
  const sesion = await obtenerSesion(request);
  if (!sesion || sesion.rol !== 'colaborador') return Response.json({ error: 'No autorizado' }, { status: 403 });

  const [lotes, colaborador] = await Promise.all([
    listarLotesPorColaborador(sesion.colaboradorId),
    obtenerColaborador(sesion.colaboradorId),
  ]);
  return Response.json({
    lotes, nombre: sesion.nombre,
    puedeInvitar: !!colaborador?.puede_invitar,
    puedeSubirFacturasGenerales: !!colaborador?.puede_subir_facturas_generales,
  });
}
