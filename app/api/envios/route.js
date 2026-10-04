const { previsualizarEnvio, marcarComoEnviado } = require('../../../lib/exportar.cjs');

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const hasta = searchParams.get('hasta');
  if (!hasta) return Response.json({ error: 'Falta la fecha hasta la que generar el envío.' }, { status: 400 });
  const resumen = await previsualizarEnvio(hasta);
  return Response.json(resumen);
}

export async function POST(request) {
  const { hasta, etiqueta, desde } = await request.json();
  if (!hasta) return Response.json({ error: 'Falta la fecha hasta la que generar el envío.' }, { status: 400 });

  try {
    const envio = await marcarComoEnviado({ hasta, etiqueta, desde });
    return Response.json({ ok: true, ...envio });
  } catch (err) {
    console.error('Error marcando el envío a gestoría', err);
    return Response.json({ error: err.message || 'No se pudo marcar el envío.' }, { status: err.status || 500 });
  }
}
