import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { limpiar, sembrarLinea } from './ayuda.js';
import { POST as estado } from '../app/api/larpmanager-pagos/[id]/estado/route.js';
import { POST as desvincular } from '../app/api/larpmanager-pagos/[id]/desvincular/route.js';
import { POST as rechazar } from '../app/api/larpmanager-pagos/[id]/rechazar/route.js';
import { GET as candidatosDePago } from '../app/api/larpmanager-pagos/[id]/candidatos/route.js';
import { GET as candidatosDeLinea } from '../app/api/movimientos/[id]/larpmanager-candidatos/route.js';
import { query } from '../lib/db.cjs';

const MARCA = 'PRUEBA-errores';

async function limpiarTodo() {
  await limpiar();
  await query(`DELETE FROM larpmanager_pagos WHERE nombre_real LIKE $1`, [`${MARCA}%`]);
}
beforeEach(limpiarTodo);
afterAll(limpiarTodo);

const post = (cuerpo = {}) => new Request('http://pruebas/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
const conId = id => ({ params: Promise.resolve({ id: String(id) }) });
const NO_EXISTE = 987654321;

async function unPago(linea = null) {
  const { rows: [p] } = await query(
    `INSERT INTO larpmanager_pagos (nombre_real, evento, importe, fecha, movimiento_id, estado) VALUES ($1, 'Glitz', 20, '2026-07-10', $2, $3) RETURNING id`,
    [`${MARCA} Ana`, linea, linea ? 'resuelta' : 'pendiente']
  );
  return Number(p.id);
}

describe('las rutas de pagos de LarpManager dicen qué ha ido mal con un código claro', () => {
  it('383. un pago que no existe da 404 en estado, desvincular, candidatos y rechazar', async () => {
    expect((await estado(post({ estado: 'ignorada' }), conId(NO_EXISTE))).status).toBe(404);
    expect((await desvincular(post(), conId(NO_EXISTE))).status).toBe(404);
    expect((await candidatosDePago(new Request('http://pruebas/'), conId(NO_EXISTE))).status).toBe(404);
    expect((await rechazar(post({ movimientoId: NO_EXISTE }), conId(NO_EXISTE))).status).toBe(404);
  });

  it('384. un estado que no existe da 400, y cambiar el estado de un pago que ya tiene línea da 409', async () => {
    const libre = await unPago();
    const linea = await sembrarLinea({ importe: 20, concepto: 'TRANSFERENCIAS ANA', fecha: '2026-07-10' });
    const enlazado = await unPago(linea.id);

    expect((await estado(post({ estado: 'borrada' }), conId(libre))).status).toBe(400);
    expect((await estado(post({ estado: 'ignorada' }), conId(enlazado))).status).toBe(409);
    expect((await estado(post({ estado: 'ignorada' }), conId(libre))).status).toBe(200);
  });

  it('385. desvincular un pago que no está vinculado da 409', async () => {
    const libre = await unPago();

    const r = await desvincular(post(), conId(libre));

    expect(r.status).toBe(409);
    expect((await r.json()).error).toContain('no está vinculado');
  });

  it('386. los pagos candidatos de una línea: la línea que no existe da 404, la que no es ingreso 400 y la que ya tiene pago 409', async () => {
    const gasto = await sembrarLinea({ importe: -20, concepto: 'UN GASTO' });
    const ocupada = await sembrarLinea({ importe: 20, concepto: 'TRANSFERENCIAS ANA', fecha: '2026-07-10' });
    await unPago(ocupada.id);
    const pedir = id => candidatosDeLinea(new Request('http://pruebas/'), conId(id));

    expect((await pedir(NO_EXISTE)).status).toBe(404);
    expect((await pedir(gasto.id)).status).toBe(400);
    expect((await pedir(ocupada.id)).status).toBe(409);
  });
});
