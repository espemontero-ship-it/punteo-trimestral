import { describe, it, expect, afterEach } from 'vitest';
import ExcelJS from 'exceljs';
import { parsearArchivoLarpManager, tipoDeArchivo } from '../lib/larpmanager.cjs';

const zonaOriginal = process.env.TZ;
afterEach(() => {
  if (zonaOriginal === undefined) delete process.env.TZ; else process.env.TZ = zonaOriginal;
});

async function excelConUnaFecha() {
  const libro = new ExcelJS.Workbook();
  const hoja = libro.addWorksheet('Sheet1');
  hoja.addRow(['Member', 'Method', 'Event', 'Net', 'Date', 'Info']);
  hoja.addRow(['Ana - A', 'Wire', 'Glitz', 20, new Date(Date.UTC(2026, 7, 15)), '']);
  return Buffer.from(await libro.xlsx.writeBuffer());
}

describe('leer las fechas de un excel de LarpManager', () => {
  for (const zona of ['UTC', 'Europe/Madrid', 'America/New_York', 'Pacific/Auckland']) {
    it(`381. la fecha de una celda sale como el día escrito (15/08/2026), aunque el servidor esté en ${zona}`, async () => {
      process.env.TZ = zona;

      const [fila] = await parsearArchivoLarpManager(await excelConUnaFecha(), 'pagos.xlsx');

      expect(fila.datosOriginales.Date).toBe('15/08/2026');
      expect(fila.fecha.toISOString().slice(0, 10)).toBe('2026-08-15');
    });
  }
});

describe('con qué tipo se guarda el archivo subido', () => {
  it('382. cada formato lleva su tipo: xlsx, xls y csv', () => {
    expect(tipoDeArchivo('pagos.xlsx')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(tipoDeArchivo('PAGOS.XLS')).toBe('application/vnd.ms-excel');
    expect(tipoDeArchivo('pagos.csv')).toBe('text/csv');
    expect(tipoDeArchivo('sin-extension')).toBe('text/csv');
    expect(tipoDeArchivo()).toBe('text/csv');
  });
});
