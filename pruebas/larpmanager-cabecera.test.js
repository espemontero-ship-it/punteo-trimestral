import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { parsearArchivoLarpManager } from '../lib/larpmanager.cjs';

const csv = columnaNombre => Buffer.from(
  `${columnaNombre},Method,Event,Net,Date,Info\r\n"Paloma Vargas - Paloma",Wire,Wield #2,13,29/09/2026,\r\n`
);

async function excelCon(columnaNombre) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.getRow(1).values = [null, null, columnaNombre, 'Method', 'Type', 'Status', 'Event', 'Net', 'Fee', 'Date', 'Info'];
  ws.getRow(2).values = [null, null, 'Paloma Vargas - Paloma', 'Wire', 'Money', 'Confirmed', 'Wield #2', 13, null, '29/09/2026', null];
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('la cabecera del export de LarpManager', () => {
  it('24. la columna del nombre puede llamarse Member o User, en CSV', async () => {
    const [conMember] = await parsearArchivoLarpManager(csv('Member'), 'a.csv');
    const [conUser] = await parsearArchivoLarpManager(csv('User'), 'b.csv');

    expect(conUser.nombreReal).toBe('Paloma Vargas');
    expect(conUser.importe).toBe(13);
    expect(conUser.entraEnCruce).toBe(true);
    expect(conUser.firma).toBe(conMember.firma);
  });

  it('25. y también en Excel, aunque la tabla empiece en la tercera columna', async () => {
    const [conMember] = await parsearArchivoLarpManager(await excelCon('Member'), 'a.xlsx');
    const [conUser] = await parsearArchivoLarpManager(await excelCon('User'), 'b.xlsx');

    expect(conUser.nombreReal).toBe('Paloma Vargas');
    expect(conUser.evento).toBe('Wield #2');
    expect(conUser.firma).toBe(conMember.firma);
    expect(conUser.datosOriginales.Member).toBe('Paloma Vargas - Paloma');
  });

  it('26. si no hay ninguna de las dos, avisa con claridad', async () => {
    await expect(parsearArchivoLarpManager(await excelCon('Otra'), 'c.xlsx')).rejects.toThrow(/Member.*User/);
  });
});
