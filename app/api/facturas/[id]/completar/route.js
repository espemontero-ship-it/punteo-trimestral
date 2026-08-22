const { completarDatosFactura } = require('../../../../../lib/facturaMatcher.cjs');

// Rellena la huella del archivo y el proveedor de una factura vieja. Vive como
// endpoint porque los archivos están en Vercel Blob y a Blob solo se llega
// desde el servidor desplegado -- desde un ordenador de casa devuelve 403.
export const maxDuration = 60;

export async function POST(request, { params }) {
  const { id } = await params;
  try {
    const resultado = await completarDatosFactura(Number(id));
    return Response.json(resultado);
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
