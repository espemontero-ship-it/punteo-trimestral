import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { limpiar, subir, sembrarLinea, lector, facturaPorNombre, HOJA } from './ayuda.js';
import { POST as recalcular } from '../app/api/facturas/recalcular/route.js';
import { query } from '../lib/db.cjs';

const limpiarTodo = async () => {
  await limpiar();
  await query(`DELETE FROM sugerencias_rechazadas WHERE hoja = $1`, [HOJA]);
};
beforeEach(limpiarTodo);
afterAll(limpiarTodo);

const BOLT = [8.50, 6.90, 24.90, 11.50, 5.71];
const unaDe = (importe, proveedor = 'Bolt Operations') => lector([{ importe, fecha: '2026-10-01', proveedor }]);

const enlaces = async facturaId => (await query(
  `SELECT movimiento_id FROM movimiento_facturas WHERE factura_id = $1`, [facturaId]
)).rows;

describe('recalcular las sugerencias de las facturas ya subidas', () => {
  it('50. una factura subida antes de que existieran los movimientos pasa a proponerlos al recalcular', async () => {
    const { archivo } = await subir({ leer: unaDe(57.51) });
    const antes = await facturaPorNombre(archivo);
    expect(antes.motivo_tipo).not.toBe('cubre_varios');

    const ids = [];
    for (const [i, importe] of BOLT.entries()) {
      const l = await sembrarLinea({ importe: -importe, fecha: `2026-09-${String(10 + i).padStart(2, '0')}`, concepto: `COMPRA EN BOLT ${i}` });
      ids.push(Number(l.id));
    }
    expect((await facturaPorNombre(archivo)).motivo_tipo).not.toBe('cubre_varios');

    const respuesta = await recalcular();
    expect(respuesta.status).toBe(200);
    const cuerpo = await respuesta.json();
    expect(cuerpo.revisadas).toBeGreaterThanOrEqual(1);

    const despues = await facturaPorNombre(archivo);
    expect(despues.motivo_tipo).toBe('cubre_varios');
    expect(despues.motivo_candidatos.movimientoIds).toEqual(ids);
    expect(despues.estado).toBe('revisar');
  });

  it('51. recalcular solo propone: no enlaza ninguna factura ni resuelve ningún movimiento', async () => {
    const { archivo } = await subir({ leer: unaDe(45) });
    const linea = await sembrarLinea({ importe: -45, fecha: '2026-09-20' });

    await recalcular();

    const factura = await facturaPorNombre(archivo);
    expect(await enlaces(factura.id)).toEqual([]);
    expect(factura.estado).not.toBe('matcheada');
    const { rows } = await query(`SELECT estado FROM movimientos WHERE id = $1`, [linea.id]);
    expect(rows[0].estado).toBe('sin_resolver');
  });

  it('52. recalcular dos veces seguidas deja las propuestas exactamente igual', async () => {
    const { archivo } = await subir({ leer: unaDe(57.51) });
    for (const [i, importe] of BOLT.entries()) {
      await sembrarLinea({ importe: -importe, fecha: `2026-09-${String(10 + i).padStart(2, '0')}`, concepto: `COMPRA EN BOLT ${i}` });
    }

    await recalcular();
    const primera = await facturaPorNombre(archivo);
    await recalcular();
    const segunda = await facturaPorNombre(archivo);

    expect(segunda.estado).toBe(primera.estado);
    expect(segunda.motivo_tipo).toBe(primera.motivo_tipo);
    expect(segunda.motivo_candidatos).toEqual(primera.motivo_candidatos);
  });
});
