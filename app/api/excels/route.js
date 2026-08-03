const { importarMovimientos } = require('../../../lib/importarExcel.cjs');

export async function POST(request) {
  const formData = await request.formData();
  const file = formData.get('file');
  const hoja = formData.get('hoja') || null;

  if (!file) return Response.json({ error: 'Falta el archivo (campo "file").' }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  const hojasEncontradas = await importarMovimientos(buffer, file.name, hoja);

  if (hojasEncontradas.length === 0) {
    return Response.json({
      error: 'No se ha reconocido ninguna pestaña (bbva/openbank/paypal) en el archivo. Si es un export suelto de un solo banco, indica a qué hoja corresponde.',
    }, { status: 422 });
  }

  return Response.json({ ok: true, hojas: hojasEncontradas });
}
