const { obtenerSesion } = require('../../../../lib/auth.cjs');
const { facturaConMismaHuella, asegurarColumnasMotivo } = require('../../../../lib/facturaMatcher.cjs');

// ¿Está ya subido este archivo? Se pregunta ANTES de subirlo, con la huella que
// calcula el navegador, para no llegar a subir un archivo repetido.
//
// Al colaborador no se le dice el número de factura: esa numeración no es suya
// y no la ve en ninguna parte.
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
