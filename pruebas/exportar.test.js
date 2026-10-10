import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { generarExcelFinal } from '../lib/exportar.cjs';
import { limpiarExportar, subida, facturaEnlazada, descargar, leer, columna, CABECERA_PAYPAL } from './ayuda-exportar.js';

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

  it('66b. todos los extractos subidos salen en el excel, aunque ninguna de sus líneas entre en el envío', async () => {
    const enviada = await subida({ lineas: [{ fecha: [7, 1], concepto: 'DE LA SUBIDA UNO', importe: -10, nota: 'n' }] });
    await subida({ lineas: [{ fecha: [7, 2], concepto: 'DE LA SUBIDA DOS', importe: -20, estado: 'sin_resolver' }] });

    const ws = (await leer(await generarExcelFinal(enviada, null, { descargar }))).getWorksheet('bbva');

    expect(columna(ws, 2, 3)).toEqual(['DE LA SUBIDA UNO', 'DE LA SUBIDA DOS']);
  });

  it('67. a la derecha de las columnas originales van todas las de Movimientos, rellenadas en TODAS las líneas', async () => {
    const a = await subida({ lineas: [
      { fecha: [7, 1], concepto: 'RESUELTA', importe: -10, nota: 'nota resuelta', proveedor: 'Prov' },
      { fecha: [7, 2], concepto: 'SIN RESOLVER', importe: -20, estado: 'sin_resolver', nota: 'nota pendiente' },
    ] });
    await facturaEnlazada(a[0].id, 990005);
    await facturaEnlazada(a[0].id, 990006);

    const ws = (await leer(await generarExcelFinal([a[0]], null, { descargar }))).getWorksheet('bbva');
    const celdas = (fila, desde = 5) => [0, 1, 2, 3, 4, 5, 6, 7].map(i => ws.getRow(fila).getCell(desde + i).value);

    expect(celdas(2)).toEqual(['Banco', 'Proveedor', 'Estado', 'Factura', 'Nota', 'Proyecto', 'LarpManager', 'Jugador']);
    expect(celdas(3)).toEqual(['bbva', 'Prov', 'resuelta', '990005, 990006', 'nota resuelta', null, null, null]);
    expect(celdas(4)).toEqual(['bbva', null, 'pendiente', null, 'nota pendiente', null, null, null]);
  });

  it('67b. el estado sale con las mismas palabras de la pantalla, para todas las líneas', async () => {
    const a = await subida({ lineas: [
      { fecha: [7, 1], concepto: 'UNO', importe: -1, estado: 'sin_resolver' },
      { fecha: [7, 2], concepto: 'DOS', importe: -2, estado: 'pedida_pendiente' },
      { fecha: [7, 3], concepto: 'TRES', importe: -3, estado: 'factura_futura' },
      { fecha: [7, 4], concepto: 'CUATRO', importe: -4, estado: 'ignorada' },
      { fecha: [7, 5], concepto: 'CINCO', importe: -5, estado: 'resuelta' },
    ] });

    const ws = (await leer(await generarExcelFinal([a[4]], null, { descargar }))).getWorksheet('bbva');

    expect(columna(ws, 7, 3)).toEqual(['pendiente', 'pedida', 'factura futura', 'ignorar', 'resuelta']);
  });

  it('67c. la hoja Devoluciones lleva todas las columnas de Movimientos y el banco, y solo las devoluciones hasta la fecha elegida', async () => {
    const a = await subida({ lineas: [
      { fecha: [9, 7], concepto: 'DEVOLUCION DE SEPTIEMBRE', importe: -300, devolucion: 'Ruben Coucke', nota: 'reembolso' },
      { fecha: [10, 3], concepto: 'DEVOLUCION DE OCTUBRE', importe: -100, devolucion: 'Ana Pérez' },
      { fecha: [9, 8], concepto: 'COMPRA NORMAL', importe: -5 },
    ] });

    const ws = (await leer(await generarExcelFinal([a[0]], null, { descargar, hasta: '2026-09-30' }))).getWorksheet('Devoluciones');

    expect(ws.getRow(1).values.slice(1)).toEqual(['Fecha', 'Concepto', 'Banco', 'Proveedor', 'Importe', 'Estado', 'Factura', 'Nota', 'Proyecto', 'LarpManager', 'Jugador']);
    expect(ws.rowCount).toBe(2);
    expect(ws.getRow(2).getCell(2).value).toBe('DEVOLUCION DE SEPTIEMBRE');
    expect(ws.getRow(2).getCell(3).value).toBe('bbva');
    expect(ws.getRow(2).getCell(5).value).toBe(-300);
    expect(ws.getRow(2).getCell(8).value).toBe('reembolso');
    expect(ws.getRow(2).getCell(11).value).toBe('Ruben Coucke');
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
