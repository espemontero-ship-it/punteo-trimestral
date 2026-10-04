import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { adivinarBanco } from '../lib/hojaBanco.cjs';

const sheetsConfig = require('../config/sheets.json').sheets;

const hojaCon = (cabecera, titulo = null) => {
  const ws = new ExcelJS.Workbook().addWorksheet('Hoja');
  if (titulo) ws.addRow([titulo]);
  ws.addRow(cabecera);
  ws.addRow(['05/10/2026', 'algo', -10]);
  return ws;
};

describe('reconocer el banco de un excel suelto por sus cabeceras', () => {
  it('94. un extracto de BBVA, con su bloque de título encima, se reconoce como bbva', () => {
    const ws = hojaCon(['Fecha contable', 'Fecha valor', 'Código', 'Concepto', 'Observaciones', 'Importe', 'Saldo', 'Divisa', 'Oficina', 'Remesa'], 'Histórico de movimientos');

    expect(adivinarBanco(ws, sheetsConfig)).toBe('bbva');
  });

  it('95. un extracto con fecha de operación y sin fecha contable se reconoce como openbank, no como bbva', () => {
    const ws = hojaCon(['Fecha Operación', 'Fecha Valor', 'Concepto', 'Importe', 'Saldo']);

    expect(adivinarBanco(ws, sheetsConfig)).toBe('openbank');
  });

  it('96. un export de PayPal se reconoce como paypal', () => {
    const ws = hojaCon(['Fecha', 'Hora', 'Zona horaria', 'Nombre', 'Tipo', 'Estado', 'Divisa', 'Bruto', 'Tarifa', 'Neto']);

    expect(adivinarBanco(ws, sheetsConfig)).toBe('paypal');
  });

  it('97. si las cabeceras no se parecen a ningún banco, no adivina', () => {
    const ws = hojaCon(['Nombre', 'Edad', 'Ciudad']);

    expect(adivinarBanco(ws, sheetsConfig)).toBeNull();
  });
});
