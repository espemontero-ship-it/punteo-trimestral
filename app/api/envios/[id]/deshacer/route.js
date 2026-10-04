const { deshacerEnvio } = require('../../../../../lib/exportar.cjs');

export async function POST(request, { params }) {
  const { id } = await params;
  try {
    const resultado = await deshacerEnvio(Number(id));
    return Response.json({ ok: true, ...resultado });
  } catch (err) {
    return Response.json({ error: err.message || 'No se pudo deshacer el envío.' }, { status: err.status || 500 });
  }
}
