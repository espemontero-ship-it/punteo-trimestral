import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { limpiar, HOJA } from './ayuda.js';
import { fusionarHoja } from '../lib/importarExcel.cjs';
import { query } from '../lib/db.cjs';

beforeEach(limpiar);
afterAll(limpiar);

const fila = ({ n, concepto, importe = -33.15, saldo, fecha = '2026-09-28' }) => ({
  fila: n, fecha, concepto, importe, clave: 'pruebas',
  datosOriginales: saldo === undefined ? {} : { SALDO: saldo },
});

const cuantas = async () => {
  const { rows } = await query(`SELECT COUNT(*) AS n FROM movimientos WHERE hoja = $1`, [HOJA]);
  return Number(rows[0].n);
};

describe('subir dos veces el mismo extracto del banco', () => {
  it('27. la misma operación con el texto distinto pero el mismo saldo no se duplica', async () => {
    const primera = await fusionarHoja(HOJA, [
      fila({ n: 1, concepto: 'PAGO CON TARJETA EN SUPERMERCADOS 5529310010997322 BAZAR SAN DIEGO', saldo: 46178.77 }),
    ], null, true);
    expect(primera).toEqual({ actualizadas: 0, insertadas: 1 });

    const segunda = await fusionarHoja(HOJA, [
      fila({ n: 9, concepto: 'PAGO CON TARJETA EN SUPERMERCADOS ************7322 BAZAR SAN DIEGO', saldo: 46178.77 }),
    ], null, true);
    expect(segunda).toEqual({ actualizadas: 1, insertadas: 0 });
    expect(await cuantas()).toBe(1);
  });

  it('28. sin la opción del saldo (otros bancos) se sigue comparando solo por el texto', async () => {
    await fusionarHoja(HOJA, [fila({ n: 1, concepto: 'COMPRA UNO', saldo: 100 })], null, false);
    const segunda = await fusionarHoja(HOJA, [fila({ n: 2, concepto: 'OTRO TEXTO MUY DISTINTO', saldo: 100 })], null, false);

    expect(segunda.insertadas).toBe(1);
    expect(await cuantas()).toBe(2);
  });

  it('29. si no hay saldo en alguna de las dos, se compara por el texto de siempre', async () => {
    await fusionarHoja(HOJA, [fila({ n: 1, concepto: 'TRANSFERENCIAS ALGUIEN REF-ABC' })], null, true);
    const igual = await fusionarHoja(HOJA, [fila({ n: 2, concepto: 'TRANSFERENCIAS ALGUIEN REF-ABC', saldo: 500 })], null, true);
    const distinta = await fusionarHoja(HOJA, [fila({ n: 3, concepto: 'TEXTO QUE NO SE PARECE EN NADA', saldo: 600 })], null, true);

    expect(igual).toEqual({ actualizadas: 1, insertadas: 0 });
    expect(distinta).toEqual({ actualizadas: 0, insertadas: 1 });
  });

  it('30. dos operaciones del mismo día e importe, con saldos distintos, siguen siendo dos al volver a subirlas', async () => {
    await fusionarHoja(HOJA, [
      fila({ n: 1, concepto: 'TRANSFERENCIAS ANA REF1', importe: 160, saldo: 1000 }),
      fila({ n: 2, concepto: 'TRANSFERENCIAS LUIS REF2', importe: 160, saldo: 1160 }),
    ], null, true);

    const otraVez = await fusionarHoja(HOJA, [
      fila({ n: 1, concepto: 'ABONO POR TRANSFERENCIA LUIS OTRO TEXTO', importe: 160, saldo: 1160 }),
      fila({ n: 2, concepto: 'ABONO POR TRANSFERENCIA ANA OTRO TEXTO', importe: 160, saldo: 1000 }),
    ], null, true);

    expect(otraVez).toEqual({ actualizadas: 2, insertadas: 0 });
    expect(await cuantas()).toBe(2);
  });

  it('31. una operación con otro saldo y otro texto es una operación nueva', async () => {
    await fusionarHoja(HOJA, [fila({ n: 1, concepto: 'COMPRA UNO', saldo: 100 })], null, true);
    const nueva = await fusionarHoja(HOJA, [fila({ n: 2, concepto: 'COMPRA TOTALMENTE DISTINTA', saldo: 70 })], null, true);

    expect(nueva).toEqual({ actualizadas: 0, insertadas: 1 });
  });
});
