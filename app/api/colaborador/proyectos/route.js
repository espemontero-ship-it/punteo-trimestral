const { obtenerSesion } = require('../../../../lib/auth.cjs');
const { listarProyectos } = require('../../../../lib/proyectos.cjs');

// Solo lectura -- crear proyectos sigue siendo cosa de administración
// (POST /api/proyectos, fuera de la zona de colaborador).
export async function GET(request) {
  const sesion = await obtenerSesion(request);
  if (!sesion || sesion.rol !== 'colaborador') return Response.json({ error: 'No autorizado' }, { status: 403 });

  const proyectos = await listarProyectos();
  return Response.json({ proyectos });
}
