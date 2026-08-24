const { obtenerSesion } = require('../../../../lib/auth.cjs');
const { facturaConMismaHuella, asegurarColumnasMotivo } = require('../../../../lib/facturaMatcher.cjs');

export async function GET(request) {
  const huella = request.nextUrl.searchParams.get('h');
  if (!huella) return Response.json({ existe: false });
  await asegurarColumnasMotivo();
  const factura = await facturaConMismaHuella(huella);
  if (!factura) return Response.json({ existe: false });

  const sesion = await obtenerSesion(request);
  if (sesion?.rol === 'colaborador') return Response.json({ existe: true });
  return Response.json({ existe: true, numero: factura.numero, nombre: factura.nombre_original });
}
