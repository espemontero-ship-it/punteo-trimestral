import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { generarExcelFinal } from '../lib/exportar.cjs';
import { limpiarExportar, subida, descargar, leer, columna, CABECERA_PAYPAL } from './ayuda-exportar.js';

beforeEach(limpiarExportar);
afterAll(limpiarExportar);

describe('el excel de la gestoría tiene una sola pestaña por banco', () => {
  it('66. varias subidas de bbva que se solapan salen en una sola pestaña "bbva", cada línea una vez y por fecha', async () => {
    const a = await subida({ lineas: [
      { fecha: [7, 1], concepto: 'COMPRA UNO', importe: -10, nota: 'nota uno', proveedor: 'Prov Uno', facturas: '5' },
      { fecha: [7, 2], concepto: 'COMPRA DOS', importe: -20 },
    ] });
    const b = await subida({ lineas: [
      { fecha: [7, 2], concepto: 'COMPRA DOS REPETIDA', importe: -20, repetida: true },
      { fecha: [7, 3], concepto: 'COMPRA TRES', importe: -30, nota: 'nota tres' },
    ] });
    const c = await subida({ lineas: [
      { fecha: [6, 30], concepto: 'COMPRA CERO', importe: -5, nota: 'nota cero' },
      { fecha: [7, 4], concepto: 'COMPRA CUATRO', importe: -40, nota: 'nota cuatro' },
    ] });

    const buffer = await generarExcelFinal([...a, ...b, ...c].filter(m => m.nota_final || m.proveedor), null, { descargar });
    const wb = await leer(buffer);

    expect(wb.worksheets.map(w => w.name)).toEqual(['bbva']);
    const ws = wb.getWorksheet('bbva');
    expect(columna(ws, 2, 3)).toEqual(['COMPRA CERO', 'COMPRA UNO', 'COMPRA DOS', 'COMPRA TRES', 'COMPRA CUATRO']);
    expect(ws.getRow(1).getCell(1).value).toBe('Movimientos');
    expect(ws.getRow(2).getCell(2).value).toBe('CONCEPTO');
  });

  it('66b. una subida donde no se envía ninguna línea no aparece en el excel', async () => {
    const enviada = await subida({ lineas: [{ fecha: [7, 1], concepto: 'DE LA SUBIDA UNO', importe: -10, nota: 'n' }] });
    await subida({ lineas: [{ fecha: [7, 2], concepto: 'DE LA SUBIDA DOS', importe: -20 }] });

    const ws = (await leer(await generarExcelFinal(enviada, null, { descargar }))).getWorksheet('bbva');

    expect(columna(ws, 2, 3)).toEqual(['DE LA SUBIDA UNO']);
  });

  it('67. las columnas de la app (nota, proveedor, facturas) solo se rellenan en las líneas que se envían', async () => {
    const a = await subida({ lineas: [
      { fecha: [7, 1], concepto: 'ENVIADA', importe: -10, nota: 'nota enviada', proveedor: 'Prov', facturas: '5, 6' },
      { fecha: [7, 2], concepto: 'NO ENVIADA', importe: -20 },
    ] });

    const buffer = await generarExcelFinal([a[0]], null, { descargar });
    const ws = (await leer(buffer)).getWorksheet('bbva');

    expect(ws.getRow(2).getCell(5).value).toBe('Nota gestoría');
    expect(ws.getRow(2).getCell(6).value).toBe('Proveedor');
    expect(ws.getRow(2).getCell(8).value).toBe('Facturas');
    expect(ws.getRow(3).getCell(5).value).toBe('nota enviada');
    expect(ws.getRow(3).getCell(6).value).toBe('Prov');
    expect(ws.getRow(3).getCell(8).value).toBe('5, 6');
    expect(ws.getRow(4).getCell(2).value).toBe('NO ENVIADA');
    expect(ws.getRow(4).getCell(5).value).toBeNull();
  });

  it('68. cada banco tiene su pestaña: bbva y paypal, sin mezclarse', async () => {
    const bbva = await subida({ lineas: [{ fecha: [7, 1], concepto: 'DE BBVA', importe: -10, nota: 'n' }] });
    const paypal = await subida({
      hoja: 'paypal', cabecera: CABECERA_PAYPAL, titulo: null,
      lineas: [{ fecha: [7, 2], concepto: 'DE PAYPAL', importe: -7, nota: 'n' }],
    });

    const wb = await leer(await generarExcelFinal([...bbva, ...paypal], null, { descargar }));

    expect(wb.worksheets.map(w => w.name)).toEqual(['bbva', 'paypal']);
    expect(columna(wb.getWorksheet('bbva'), 2, 3)).toEqual(['DE BBVA']);
    expect(columna(wb.getWorksheet('paypal'), 2, 2)).toEqual(['DE PAYPAL']);
  });

  it('69. una subida con columnas distintas no se mezcla: va a su propia pestaña para no descuadrar nada', async () => {
    const normal = await subida({ lineas: [{ fecha: [7, 1], concepto: 'FORMATO NORMAL', importe: -10, nota: 'n' }] });
    const distinta = await subida({
      cabecera: ['F. CONTABLE', 'EXTRA', 'CONCEPTO', 'IMPORTE', 'SALDO'],
      lineas: [{ fecha: [7, 2], concepto: 'FORMATO DISTINTO', importe: -20, nota: 'n' }],
    });

    const wb = await leer(await generarExcelFinal([...normal, ...distinta], null, { descargar }));

    expect(wb.worksheets.map(w => w.name)).toEqual(['bbva', 'bbva (2)']);
    expect(columna(wb.getWorksheet('bbva'), 2, 3)).toEqual(['FORMATO NORMAL']);
  });

  it('70b. el título combinado del extracto sigue combinado, no repetido en cada columna', async () => {
    const a = await subida({ combinarTitulo: true, lineas: [{ fecha: [7, 1], concepto: 'CON TITULO COMBINADO', importe: -10, nota: 'n' }] });

    const ws = (await leer(await generarExcelFinal(a, null, { descargar }))).getWorksheet('bbva');

    expect(ws.model.merges).toEqual(['A1:D1']);
    expect(ws.getRow(1).getCell(1).value).toBe('Movimientos');
  });

  it('70. se conservan el formato de las fechas y el ancho de las columnas', async () => {
    const a = await subida({ lineas: [{ fecha: [7, 1], concepto: 'CON FORMATO', importe: -10, nota: 'n' }] });

    const ws = (await leer(await generarExcelFinal(a, null, { descargar }))).getWorksheet('bbva');

    expect(ws.getRow(3).getCell(1).numFmt).toBe('dd/mm/yyyy');
    expect(ws.getColumn(2).width).toBe(40);
  });
});
