import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { esCsv, convertirCsv } from '../lib/csvBanco.cjs';
import { detectarHoja } from '../lib/hojaBanco.cjs';
import { cellNumber, cellDate } from '../lib/cells.cjs';

const CFG_PAYPAL = { cabeceraContiene: ['FECHA', 'NETO'], columnas: { fecha: ['FECHA'], texto: ['NOMBRE', 'TIPO', 'ASUNTO', 'NOTA'], importe: ['NETO'] } };

const csvDePaypal = ({ separador = ',', bom = true } = {}) => Buffer.from(
  (bom ? '﻿' : '') + [
    ['Fecha', 'Hora', 'Nombre', 'Tipo', 'Bruto', 'Tarifa', 'Neto'].join(separador),
    ['25/08/2026', '14:38:23', '"Iberia LAE, SA"', 'Reembolso de pago', '"51,93"', '0', '"51,93"'].join(separador),
    ['06/09/2026', '20:54:09', 'Aine Sweeney-McCabe', 'Pago general', '-300', '0', '-300'].join(separador),
    ['16/09/2026', '20:06:27', 'Airbnb', 'Pago', '"-731,77"', '0', '"-731,77"'].join(separador),
  ].join('\r\n'), 'utf8'
);

async function hojaDe(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(convertirCsv(buffer));
  return wb.worksheets[0];
}

describe('los CSV del banco (PayPal) se aceptan', () => {
  it('83. se reconoce un CSV por su extensión, en mayúsculas o minúsculas', () => {
    expect(esCsv('paypal.csv')).toBe(true);
    expect(esCsv('PAYPAL (2).CSV')).toBe(true);
    expect(esCsv('bbva.xlsx')).toBe(false);
    expect(esCsv(undefined)).toBe(false);
  });

  it('84. con la marca invisible del principio y los importes con coma, la cabecera y los céntimos salen bien', async () => {
    const ws = await hojaDe(csvDePaypal());

    expect(ws.getRow(1).getCell(1).value).toBe('Fecha');
    const d = detectarHoja(ws, CFG_PAYPAL);
    expect(d.filaCabecera).toBe(1);
    expect(d.columnas.importe).toBe(7);
    expect(cellNumber(ws.getRow(2), d.columnas.importe)).toBe(51.93);
    expect(cellNumber(ws.getRow(3), d.columnas.importe)).toBe(-300);
    expect(cellNumber(ws.getRow(4), d.columnas.importe)).toBe(-731.77);
    expect(cellDate(ws.getRow(2), d.columnas.fecha).toISOString().slice(0, 10)).toBe('2026-08-25');
    expect(cellDate(ws.getRow(4), d.columnas.fecha).toISOString().slice(0, 10)).toBe('2026-09-16');
  });

  it('85. también vale con punto y coma como separador y sin la marca del principio', async () => {
    const ws = await hojaDe(csvDePaypal({ separador: ';', bom: false }));

    const d = detectarHoja(ws, CFG_PAYPAL);
    expect(d.columnas.importe).toBe(7);
    expect(cellNumber(ws.getRow(4), d.columnas.importe)).toBe(-731.77);
  });

  it('86. un importe escrito como texto se lee con sus céntimos; los que ya son números no cambian', () => {
    const fila = valor => ({ getCell: () => ({ value: valor }) });

    expect(cellNumber(fila('51,93'), 1)).toBe(51.93);
    expect(cellNumber(fila('-731,77'), 1)).toBe(-731.77);
    expect(cellNumber(fila('1.234,56'), 1)).toBe(1234.56);
    expect(cellNumber(fila('1234.56'), 1)).toBe(1234.56);
    expect(cellNumber(fila(45.5), 1)).toBe(45.5);
    expect(cellNumber(fila('no es un número'), 1)).toBeNull();
    expect(cellNumber(fila(null), 1)).toBeNull();
  });

  it('87. un CSV vacío da un mensaje claro', () => {
    expect(() => convertirCsv(Buffer.from(''))).toThrow(/No se ha podido leer el archivo CSV/);
  });
});
