const { reintentarPendientes } = require('../../../../lib/facturaMatcher.cjs');

export async function POST() {
  try {
    const { revisadas } = await reintentarPendientes();
    return Response.json({ ok: true, revisadas });
  } catch (e) {
    return Response.json({ error: e.message || 'No se pudo recalcular.' }, { status: 500 });
  }
}
