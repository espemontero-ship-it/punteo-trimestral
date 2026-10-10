import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { limpiar, sembrarLinea } from './ayuda.js';
import { parsearCSV, procesarSubidaLarpManager, listarLineasConMasDeUnPago } from '../lib/larpmanager.cjs';
import { query } from '../lib/db.cjs';

const MARCA = 'PRUEBA-subida';
const ARCHIVO = `${MARCA}.csv`;

async function limpiarTodo() {
  await limpiar();
  await query(`DELETE FROM larpmanager_pagos WHERE nombre_real LIKE $1`, [`${MARCA}%`]);
  await query(`DELETE FROM importaciones WHERE nombre_archivo LIKE $1`, [`${MARCA}%`]);
}
beforeEach(limpiarTodo);
afterAll(limpiarTodo);

const filasDe = (...nombres) => parsearCSV(Buffer.from([
  'Member,Method,Event,Net,Date,Info',
  ...nombres.map(n => `"${MARCA} ${n} - ${n}",Wire,Glitz,20,10/07/2026,`),
].join('\r\n')));

function archivoDeMentira() {
  const borrados = [];
  return {
    borrados,
    guardarArchivo: async () => `https://ejemplo/${MARCA}-${Math.random()}.csv`,
    borrarArchivo: async ruta => { borrados.push(ruta); },
  };
}

const subidasRegistradas = async () => (await query(`SELECT id FROM importaciones WHERE nombre_archivo = $1`, [ARCHIVO])).rows;
const pagosGuardados = async () => (await query(`SELECT id, importacion_id FROM larpmanager_pagos WHERE nombre_real LIKE $1`, [`${MARCA}%`])).rows;

describe('subir un archivo de LarpManager', () => {
  it('360. una subida con pagos nuevos queda registrada, con sus pagos y su archivo', async () => {
    const falso = archivoDeMentira();

    const r = await procesarSubidaLarpManager({ filas: filasDe('Ana', 'Beto'), nombreArchivo: ARCHIVO, ...falso });

    expect(r.nadaNuevo).toBe(false);
    expect((await subidasRegistradas()).map(s => String(s.id))).toEqual([String(r.importacionId)]);
    expect((await pagosGuardados()).every(p => String(p.importacion_id) === String(r.importacionId))).toBe(true);
    expect(await pagosGuardados()).toHaveLength(2);
    expect(falso.borrados).toEqual([]);
  });

  it('361. volver a subir lo mismo no deja una subida vacía ni un archivo guardado de más', async () => {
    const primera = archivoDeMentira();
    await procesarSubidaLarpManager({ filas: filasDe('Ana', 'Beto'), nombreArchivo: ARCHIVO, ...primera });
    const segunda = archivoDeMentira();

    const r = await procesarSubidaLarpManager({ filas: filasDe('Ana', 'Beto'), nombreArchivo: ARCHIVO, ...segunda });

    expect(r.nadaNuevo).toBe(true);
    expect(r.importacionId).toBeNull();
    expect(await subidasRegistradas()).toHaveLength(1);
    expect(await pagosGuardados()).toHaveLength(2);
    expect(segunda.borrados).toHaveLength(1);
  });

  it('362. si algo falla a mitad, no queda una subida vacía y se borra el archivo guardado', async () => {
    const falso = archivoDeMentira();
    const rota = filasDe('Ana');
    const circular = {};
    circular.yo = circular;
    rota[0].datosOriginales = circular;

    await expect(procesarSubidaLarpManager({ filas: rota, nombreArchivo: ARCHIVO, ...falso })).rejects.toThrow();

    expect(await subidasRegistradas()).toHaveLength(0);
    expect(await pagosGuardados()).toHaveLength(0);
    expect(falso.borrados).toHaveLength(1);
  });

  it('363. dos subidas del mismo archivo a la vez guardan cada pago una sola vez y solo una queda registrada', async () => {
    const a = archivoDeMentira();
    const b = archivoDeMentira();

    const [r1, r2] = await Promise.all([
      procesarSubidaLarpManager({ filas: filasDe('Ana', 'Beto'), nombreArchivo: ARCHIVO, ...a }),
      procesarSubidaLarpManager({ filas: filasDe('Ana', 'Beto'), nombreArchivo: ARCHIVO, ...b }),
    ]);

    expect(await pagosGuardados()).toHaveLength(2);
    expect(await subidasRegistradas()).toHaveLength(1);
    expect([r1.nadaNuevo, r2.nadaNuevo].sort()).toEqual([false, true]);
  });
});

describe('las líneas del banco con más de un pago enlazado', () => {
  it('364. se listan las que tienen dos pagos, con sus pagos, y no las que tienen uno', async () => {
    const doble = await sembrarLinea({ importe: 20, concepto: 'INGRESO CON DOS PAGOS', fecha: '2026-07-10', estado: 'resuelta' });
    const simple = await sembrarLinea({ importe: 20, concepto: 'INGRESO CON UN PAGO', fecha: '2026-07-11', estado: 'resuelta' });
    await procesarSubidaLarpManager({ filas: filasDe('Ana', 'Beto', 'Cleo'), nombreArchivo: ARCHIVO, ...archivoDeMentira() });
    const pagos = await pagosGuardados();
    await query(`UPDATE larpmanager_pagos SET movimiento_id = $1 WHERE id = ANY($2::bigint[])`, [doble.id, [pagos[0].id, pagos[1].id]]);
    await query(`UPDATE larpmanager_pagos SET movimiento_id = $1 WHERE id = $2`, [simple.id, pagos[2].id]);

    const lineas = await listarLineasConMasDeUnPago();

    expect(lineas.filter(l => String(l.movimiento_id) === String(doble.id))).toHaveLength(1);
    expect(lineas.find(l => String(l.movimiento_id) === String(doble.id)).pagos).toHaveLength(2);
    expect(lineas.some(l => String(l.movimiento_id) === String(simple.id))).toBe(false);
  });
});
