const { listarEnvios } = require('../../../../lib/exportar.cjs');

export async function GET() {
  return Response.json({ envios: await listarEnvios() });
}
