import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { limpiar, sembrarLinea, lineaPorId } from './ayuda.js';
import {
  parsearCSV, emparejarIngresosConLarpManager, vincularPagoAMano, repararPagosDoblados, activarReglaUnPagoPorLinea,
} from '../lib/larpmanager.cjs';
import { POST as resolverLm } from '../app/api/movimientos/[id]/resolver-larpmanager/route.js';
import { query } from '../lib/db.cjs';

const MARCA = 'PRUEBA-base';
const ANA = `${MARCA} Ana`;

async function limpiarTodo() {
  await limpiar();
  await query(`DELETE FROM larpmanager_pagos WHERE nombre_real LIKE $1`, [`${MARCA}%`]);
  await query(`DELETE FROM larpmanager_pagos_reparados WHERE pago->>'nombre_real' LIKE $1`, [`${MARCA}%`]);
  await activarReglaUnPagoPorLinea();
}
beforeEach(limpiarTodo);
afterAll(limpiarTodo);

async function pago({ nombre = ANA, evento = 'Glitz', importe = 20, fecha = '2026-07-10', linea = null, firma = null, orden = 0 }) {
  const { rows: [p] } = await query(
    `INSERT INTO larpmanager_pagos (nombre_real, evento, importe, fecha, movimiento_id, estado, firma, orden) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [nombre, evento, importe, fecha, linea, linea ? 'resuelta' : 'pendiente', firma, orden]
  );
  return Number(p.id);
}
const pagoPorId = async id => (await query(`SELECT * FROM larpmanager_pagos WHERE id = $1`, [id])).rows[0];
const copias = async () => (await query(`SELECT motivo, pago FROM larpmanager_pagos_reparados WHERE pago->>'nombre_real' LIKE $1 ORDER BY id`, [`${MARCA}%`])).rows;
const sinLaRegla = () => query(`DROP INDEX IF EXISTS larpmanager_pagos_un_pago_por_linea`);
const post = (cuerpo = {}) => new Request('http://pruebas/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
const conId = id => ({ params: Promise.resolve({ id: String(id) }) });

describe('la regla de la base de datos: una línea del banco, un solo pago', () => {
  it('370. la base de datos rechaza un segundo pago enlazado a la misma línea, aunque se intente directamente', async () => {
    const linea = await sembrarLinea({ importe: 20, concepto: 'TRANSFERENCIAS ANA', fecha: '2026-07-10' });
    await pago({ linea: linea.id });

    await expect(pago({ linea: linea.id, fecha: '2026-07-11' })).rejects.toMatchObject({ code: '23505' });
  });

  it('371. dos pagos iguales pendientes: el enlace automático a una línea resuelta enlaza solo uno', async () => {
    const linea = await sembrarLinea({ importe: 20, concepto: 'TRANSFERENCIAS PRUEBA BASE ANA', fecha: '2026-07-10', estado: 'resuelta' });
    const dos = Buffer.from(['Member,Method,Event,Net,Date,Info', `"${ANA} - Ana",Wire,Glitz,20,10/07/2026,`, `"${ANA} - Ana",Wire,Glitz,20,10/07/2026,`].join('\r\n'));

    await emparejarIngresosConLarpManager(parsearCSV(dos), null);

    const { rows } = await query(`SELECT movimiento_id FROM larpmanager_pagos WHERE nombre_real = $1`, [ANA]);
    expect(rows).toHaveLength(2);
    expect(rows.filter(r => String(r.movimiento_id) === String(linea.id))).toHaveLength(1);
  });

  it('372. aceptar una sugerencia en una línea que ya tiene pago da 409 y no cambia la línea', async () => {
    const linea = await sembrarLinea({ importe: 20, concepto: 'TRANSFERENCIAS PRUEBA BASE ANA', fecha: '2026-07-10' });
    await pago({ linea: linea.id });
    await pago({ fecha: '2026-07-12' });

    const r = await resolverLm(post({ nombreReal: ANA, evento: 'Glitz', importe: 20, fecha: '2026-07-12', proyectoSugerido: null }), conId(linea.id));

    expect(r.status).toBe(409);
    expect((await r.json()).error).toContain('ya tiene un pago');
    expect((await lineaPorId(linea.id)).estado).toBe('sin_resolver');
  });

  it('373. vincular a mano un pago a una línea ocupada da 409 y la línea no cambia de estado', async () => {
    const linea = await sembrarLinea({ importe: 20, concepto: 'TRANSFERENCIAS PRUEBA BASE ANA', fecha: '2026-07-10' });
    await pago({ linea: linea.id });
    const otro = await pago({ fecha: '2026-07-12' });

    await expect(vincularPagoAMano(otro, linea.id)).rejects.toMatchObject({ status: 409 });

    expect((await pagoPorId(otro)).movimiento_id).toBeNull();
    expect((await lineaPorId(linea.id)).estado).toBe('sin_resolver');
  });
});

describe('la reparación de las líneas con dos pagos', () => {
  const plan = (copia, original, desvincular = []) => ({ borrarCopias: [[copia, original]], desvincular });

  it('374. una copia idéntica al original y enlazada a la misma línea se borra, y se guarda una copia de seguridad', async () => {
    await sinLaRegla();
    const linea = await sembrarLinea({ importe: 20, concepto: 'TRANSFERENCIAS ANA', fecha: '2026-07-10' });
    const original = await pago({ linea: linea.id });
    const copia = await pago({ linea: linea.id });

    await repararPagosDoblados(plan(copia, original));

    expect(await pagoPorId(copia)).toBeUndefined();
    expect(String((await pagoPorId(original)).movimiento_id)).toBe(String(linea.id));
    const guardadas = await copias();
    expect(guardadas).toHaveLength(1);
    expect(guardadas[0].pago).toMatchObject({ id: copia, nombre_real: ANA, importe: 20 });
  });

  it('374b. al borrar la copia, el original que tenía un número de orden mayor que 0 pasa a tener el 0, para que un archivo nuevo lo reconozca', async () => {
    await sinLaRegla();
    const firma = `${MARCA}-firma-374b`;
    const linea = await sembrarLinea({ importe: 20, concepto: 'TRANSFERENCIAS ANA', fecha: '2026-07-10' });
    const original = await pago({ linea: linea.id, firma, orden: 1 });
    const copia = await pago({ linea: linea.id, firma, orden: 0 });

    await repararPagosDoblados(plan(copia, original));

    expect((await pagoPorId(original)).orden).toBe(0);
    expect((await copias()).map(c => c.motivo)).toEqual([expect.stringContaining('copia borrada'), expect.stringContaining('renumerado a 0')]);
  });

  it('375. no borra nada si el pago NO es idéntico, o si está en otra línea, o si es más antiguo que el original', async () => {
    await sinLaRegla();
    const linea = await sembrarLinea({ importe: 20, concepto: 'TRANSFERENCIAS ANA', fecha: '2026-07-10' });
    const otraLinea = await sembrarLinea({ importe: 20, concepto: 'TRANSFERENCIAS ANA', fecha: '2026-07-10' });
    const original = await pago({ linea: linea.id });
    const distinto = await pago({ linea: linea.id, fecha: '2026-07-11' });
    const enOtraLinea = await pago({ linea: otraLinea.id });

    await repararPagosDoblados({ borrarCopias: [[distinto, original], [enOtraLinea, original], [original, distinto]], desvincular: [] });

    for (const id of [original, distinto, enOtraLinea]) expect(await pagoPorId(id)).toBeDefined();
    expect(await copias()).toHaveLength(0);
  });

  it('376. un pago real distinto se desvincula y vuelve a pendiente, solo si la línea tiene otro pago; no se borra', async () => {
    await sinLaRegla();
    const linea = await sembrarLinea({ importe: 20, concepto: 'TRANSFERENCIAS ANA', fecha: '2026-07-10' });
    const sola = await sembrarLinea({ importe: 20, concepto: 'TRANSFERENCIAS ANA', fecha: '2026-07-10' });
    const original = await pago({ linea: linea.id });
    const real = await pago({ linea: linea.id, fecha: '2026-10-10' });
    const unico = await pago({ linea: sola.id, fecha: '2026-10-11' });

    await repararPagosDoblados({ borrarCopias: [], desvincular: [
      { pago: real, linea: linea.id, seQuedaEnLaLinea: original },
      { pago: unico, linea: sola.id, seQuedaEnLaLinea: original },
    ] });

    expect(await pagoPorId(real)).toMatchObject({ movimiento_id: null, estado: 'pendiente' });
    expect(String((await pagoPorId(unico)).movimiento_id)).toBe(String(sola.id));
    expect(String((await pagoPorId(original)).movimiento_id)).toBe(String(linea.id));
    expect(await copias()).toHaveLength(1);
  });

  it('377. repetirla no cambia nada más, y después de repararla la regla de la base de datos se puede activar', async () => {
    await sinLaRegla();
    const linea = await sembrarLinea({ importe: 20, concepto: 'TRANSFERENCIAS ANA', fecha: '2026-07-10' });
    const original = await pago({ linea: linea.id });
    const copia = await pago({ linea: linea.id });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(await activarReglaUnPagoPorLinea()).toBe(false);
    expect(error).toHaveBeenCalledTimes(1);

    await repararPagosDoblados(plan(copia, original));
    await repararPagosDoblados(plan(copia, original));

    expect(await copias()).toHaveLength(1);
    expect(await activarReglaUnPagoPorLinea()).toBe(true);
    error.mockRestore();
  });
});
