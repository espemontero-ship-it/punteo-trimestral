import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { limpiar, sembrarLinea } from './ayuda.js';
import { parsearCSV, emparejarIngresosConLarpManager } from '../lib/larpmanager.cjs';
import { query } from '../lib/db.cjs';

const MARCA = 'PRUEBA-guardado';
const ANA = `${MARCA} Ana`;

async function limpiarTodo() {
  await limpiar();
  await query(`DELETE FROM larpmanager_pagos WHERE nombre_real LIKE $1`, [`${MARCA}%`]);
}
beforeEach(limpiarTodo);
afterAll(limpiarTodo);

const archivo = (...filas) => parsearCSV(Buffer.from([
  'Member,Method,Event,Net,Date,Info',
  ...filas.map(({ evento = 'Glitz', importe = 20, fecha = '10/07/2026' } = {}) => `"${ANA} - Ana",Wire,${evento},${importe},${fecha},`),
].join('\r\n')));

const subir = filas => emparejarIngresosConLarpManager(filas, null);
const guardados = async () => (await query(`SELECT id, evento, orden, movimiento_id FROM larpmanager_pagos WHERE nombre_real = $1 ORDER BY id`, [ANA])).rows;

describe('no guardar dos veces un pago que ya se tiene', () => {
  it('390. ya hay 1 guardado, aunque con el número de orden descuadrado, y el archivo trae 1 igual: no se guarda ninguno', async () => {
    await subir(archivo({}));
    await query(`UPDATE larpmanager_pagos SET orden = 1 WHERE nombre_real = $1`, [ANA]);

    await subir(archivo({}));

    expect(await guardados()).toHaveLength(1);
  });

  it('391. ya hay 1 guardado y el archivo trae 2 iguales: se guarda solo el que falta, y repetirlo no añade más', async () => {
    await subir(archivo({}));
    await query(`UPDATE larpmanager_pagos SET orden = 1 WHERE nombre_real = $1`, [ANA]);

    await subir(archivo({}, {}));
    expect(await guardados()).toHaveLength(2);
    await subir(archivo({}, {}));

    expect(await guardados()).toHaveLength(2);
  });

  it('392. la misma persona, fecha e importe en dos eventos distintos son dos pagos: un archivo de un solo evento no pierde el otro', async () => {
    await subir(archivo({ evento: 'Glitz' }));

    await subir(archivo({ evento: 'Wield #2' }));
    await subir(archivo({ evento: 'Wield #2' }));
    await subir(archivo({ evento: 'Glitz' }));

    expect((await guardados()).map(p => p.evento).sort()).toEqual(['Glitz', 'Wield #2']);
  });

  it('393. un pago ya guardado y enlazado no se ofrece otra vez a otra línea, aunque su número de orden esté descuadrado', async () => {
    const enlazada = await sembrarLinea({ importe: 20, concepto: 'TRANSFERENCIAS PRUEBA GUARDADO ANA', fecha: '2026-07-10', estado: 'resuelta' });
    await subir(archivo({}));
    await query(`UPDATE larpmanager_pagos SET orden = 1 WHERE nombre_real = $1`, [ANA]);
    const otra = await sembrarLinea({ importe: 20, concepto: 'TRANSFERENCIAS PRUEBA GUARDADO ANA', fecha: '2026-07-11' });

    const resultados = await subir(archivo({}));

    const pagos = await guardados();
    expect(pagos).toHaveLength(1);
    expect(String(pagos[0].movimiento_id)).toBe(String(enlazada.id));
    expect(resultados.find(r => String(r.movimientoId) === String(otra.id))?.tipo ?? 'no_encontrado').not.toBe('match');
  });

  it('394. dos pagos iguales de verdad: el archivo trae 2, se guardan 2, y subir lo mismo otra vez no cambia nada', async () => {
    await subir(archivo({}, {}));
    await subir(archivo({}, {}));

    expect((await guardados()).map(p => p.orden).sort()).toEqual([0, 1]);
  });
});
