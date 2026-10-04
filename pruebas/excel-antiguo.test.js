import { describe, it, expect } from 'vitest';
import XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import { esExcelAntiguo, convertirExcelAntiguo } from '../lib/excelAntiguo.cjs';
import { detectarHoja } from '../lib/hojaBanco.cjs';

const CABECERA = ['Fecha contable', 'Fecha valor', 'Código', 'Concepto', 'Observaciones', 'Importe', 'Saldo'];

function excelAntiguo() {
  const hoja = XLSX.utils.aoa_to_sheet([
    ['Histórico de movimientos'],
    [],
    CABECERA,
    ['05/10/2026', '04/10/2026', '0163', 'TRANSFERENCIAS PRUEBA UNO', 'obs', -47.24, 45569.45],
    ['04/10/2026', '03/10/2026', '0163', 'TRANSFERENCIAS PRUEBA DOS', 'obs', 42.42, 45616.69],
  ]);
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, 'HistoricoMovimientos');
  return XLSX.write(libro, { type: 'buffer', bookType: 'biff8' });
}

describe('los excels del formato antiguo (.xls) se aceptan', () => {
  it('80. se distingue un .xls antiguo de un .xlsx moderno', async () => {
    const moderno = await new ExcelJS.Workbook().xlsx.writeBuffer();

    expect(esExcelAntiguo(excelAntiguo())).toBe(true);
    expect(esExcelAntiguo(Buffer.from(moderno))).toBe(false);
    expect(esExcelAntiguo(Buffer.from('<html>no soy un excel</html>'))).toBe(false);
  });

  it('81. al convertirlo se conservan los textos, los números y la fila de cabeceras, y la app reconoce el banco', async () => {
    const convertido = convertirExcelAntiguo(excelAntiguo());
    expect(Buffer.from(convertido).subarray(0, 2).toString('latin1')).toBe('PK');

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(convertido);
    const ws = wb.worksheets[0];

    expect(ws.getRow(4).getCell(1).value).toBe('05/10/2026');
    expect(ws.getRow(4).getCell(4).value).toBe('TRANSFERENCIAS PRUEBA UNO');
    expect(ws.getRow(4).getCell(6).value).toBe(-47.24);
    expect(ws.getRow(5).getCell(7).value).toBe(45616.69);

    const detectado = detectarHoja(ws, { cabeceraContiene: ['CONCEPTO', 'IMPORTE'], columnas: { fecha: ['FECHA CONTABLE'], texto: ['CONCEPTO'], importe: ['IMPORTE'] } });
    expect(detectado.filaCabecera).toBe(3);
    expect(detectado.columnas.importe).toBe(6);
  });

  it('82. un archivo que no se puede abrir da un mensaje claro en vez de romper', () => {
    const estropeado = Buffer.concat([Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]), Buffer.alloc(600, 7)]);

    expect(() => convertirExcelAntiguo(estropeado)).toThrow(/No se ha podido abrir el archivo \.xls/);
  });
});
