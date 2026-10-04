import { describe, it, expect } from 'vitest';
import XLSX from 'xlsx';
import { parsearArchivoLarpManager } from '../lib/larpmanager.cjs';

const CABECERA = ['Member', 'Method', 'Type', 'Status', 'Event', 'Net', 'Fee', 'Date', 'Info'];

function excelAntiguo(fecha) {
  const hoja = XLSX.utils.aoa_to_sheet([
    CABECERA,
    ['Paloma Vargas - Paloma', 'Wire', 'Money', 'Confirmed', 'Wield #2', 13, 0, fecha, ''],
  ], { cellDates: true });
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, 'Sheet1');
  return XLSX.write(libro, { type: 'buffer', bookType: 'biff8', cellDates: true });
}

describe('los pagos de LarpManager en el Excel antiguo (.xls)', () => {
  it('98. se lee un .xls real, con la fecha escrita como texto', async () => {
    const [fila] = await parsearArchivoLarpManager(excelAntiguo('29/09/2026'), 'pagos.xls');

    expect(fila.nombreReal).toBe('Paloma Vargas');
    expect(fila.evento).toBe('Wield #2');
    expect(fila.importe).toBe(13);
    expect(fila.fecha.toISOString().slice(0, 10)).toBe('2026-09-29');
    expect(fila.entraEnCruce).toBe(true);
  });

  it('99. y también cuando la fecha es una fecha de verdad, sin que se mueva un día', async () => {
    const [fila] = await parsearArchivoLarpManager(excelAntiguo(new Date(2026, 8, 29)), 'pagos.xls');

    expect(fila.importe).toBe(13);
    expect(fila.fecha.toISOString().slice(0, 10)).toBe('2026-09-29');
  });
});
