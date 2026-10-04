import { describe, it, expect } from 'vitest';
import { parseImporte } from '../lib/numero.cjs';
import {
  normalizeKey, clasificarClave, pistasProveedor, inferirProveedorPorTexto, proveedorSugeridoDesdeClave,
} from '../lib/normalize.cjs';
import { avisoDeDesvio, textoComboFacturas, textoCubreVarios, textoCubreVariosCorto, sumaDeMovimientos } from '../lib/textoCombo.cjs';
import { esHtmlDisfrazadoDeExcel, convertirHtmlAWorkbook } from '../lib/openbankHtml.cjs';

describe('los importes escritos como texto', () => {
  it('100. se leen con coma decimal, con punto de miles y con signo', () => {
    expect(parseImporte('51,93')).toBe(51.93);
    expect(parseImporte('-731,77')).toBe(-731.77);
    expect(parseImporte('1.234,56')).toBe(1234.56);
    expect(parseImporte('1,234.56')).toBe(1234.56);
    expect(parseImporte('-300')).toBe(-300);
    expect(parseImporte('  7,00 ')).toBe(7);
  });

  it('101. lo que no es un número da NaN en vez de inventarse uno', () => {
    expect(Number.isNaN(parseImporte('abc'))).toBe(true);
    expect(Number.isNaN(parseImporte(''))).toBe(true);
    expect(Number.isNaN(parseImporte(null))).toBe(true);
  });
});

describe('la clave que agrupa los movimientos del banco', () => {
  it('102. dos compras en el mismo sitio con distinto número de operación tienen la misma clave', () => {
    const a = normalizeKey('COMPRA EN BOLT.EU/B/2609302321, CON LA TARJETA : 5489133165781624 EL 2026-10-01', -5.71);
    const b = normalizeKey('COMPRA EN BOLT.EU/B/2609111143, CON LA TARJETA : 5489133165781624 EL 2026-09-14', -6.90);

    expect(a).toBe('- COMPRA EN BOLT EU/B/');
    expect(b).toBe(a);
  });

  it('103. el signo del importe forma parte de la clave: un cobro y un pago no se mezclan', () => {
    expect(normalizeKey('Amazon Marketplace', 10)).toBe('+ AMAZON');
    expect(normalizeKey('AMAZON PAYMENTS EUROPE', -15.97)).toBe('- AMAZON');
  });

  it('104. los ingresos por transferencia se juntan en uno solo, pero un pago a una persona no', () => {
    expect(normalizeKey('TRANSFERENCIAS SCANAGATTA MAURO 140000071861169428', 42.42)).toBe('+ TRANSFERENCIAS RECIBIDAS (ingresos)');
    expect(normalizeKey('ABONO POR TRANSFERENCIA DE FULANO', 100)).toBe('+ TRANSFERENCIAS RECIBIDAS (ingresos)');
    expect(normalizeKey('TRANSFERENCIAS SCANAGATTA MAURO 140000071861169428', -509)).toBe('- TRANSFERENCIAS SCANAGATTA MAURO');
  });

  it('105. los impuestos y los abonos en tarjeta tienen su clave propia', () => {
    expect(normalizeKey('TRIBUTOS NRC 12345 AEAT', -200)).toBe('- CARGO POR PAGO DE IMPUESTOS (tributos)');
    expect(normalizeKey('ABONO EN LA TARJETA 5489 EL 2026-10-01', 12.5)).toBe('+ ABONO EN LA TARJETA 2026-10-01 12.50');
  });

  it('106. los números largos, las referencias de remesa y los puntos no cambian la clave', () => {
    expect(normalizeKey('LIQUID.LIQUIDA REMESAS COMERCI COMERC 364149559  REM 20261003', 42.42)).toBe('+ LIQUID LIQUIDA REMESAS COMERCI');
  });

  it('107. con texto o importe vacíos no se rompe', () => {
    expect(normalizeKey(null, null)).toBe('');
    expect(normalizeKey('', 5)).toBe('+ ');
  });
});

describe('lo que la app aprende de las notas y los proveedores', () => {
  it('108. con un historial claro sugiere la nota más usada; con uno repartido pide revisarlo; sin historial, avisa', () => {
    expect(clasificarClave(null).categoria).toBe('nueva');
    expect(clasificarClave({ total: 5, notas: { material: 4, otro: 1 } })).toMatchObject({ categoria: 'fija', sugerenciaNota: 'material' });
    expect(clasificarClave({ total: 4, notas: { a: 2, b: 2 } })).toMatchObject({ categoria: 'mixta', sugerenciaNota: null });
  });

  it('109. reconoce a los proveedores conocidos aunque estén escritos de otra forma', () => {
    expect(inferirProveedorPorTexto('pago amazon eu')).toBe('Amazon');
    expect(inferirProveedorPorTexto('Stripe payments')).toBe('Stripe');
    expect(inferirProveedorPorTexto('Bolt')).toBeNull();
  });

  it('110. las pistas de proveedor ignoran las palabras vacías y las cortas', () => {
    expect(pistasProveedor('COMPRA EN FERRETERIA PEPE CON TARJETA')).toEqual(['FERRETERIA', 'PEPE']);
    expect(pistasProveedor(null)).toEqual([]);
  });

  it('111. el proveedor se saca de lo que va después de "compra en" o "recibo", sin la cola de la tarjeta', () => {
    expect(proveedorSugeridoDesdeClave('- COMPRA EN FERRETERIA LOPEZ, CON LA TARJETA : 54 EL 2026')).toBe('FERRETERIA LOPEZ');
    expect(proveedorSugeridoDesdeClave('- PAGO CON TARJETA EN GASOLINERAS ************7322 CRED')).toBe('GASOLINERAS');
    expect(proveedorSugeridoDesdeClave('- RECIBO ENDESA ENERGIA')).toBe('ENDESA ENERGIA');
  });

  it('112. si la clave no tiene esa forma, o el nombre queda demasiado corto, no propone nada', () => {
    expect(proveedorSugeridoDesdeClave('+ TRANSFERENCIAS X')).toBeNull();
    expect(proveedorSugeridoDesdeClave('- COMPRA EN AB')).toBeNull();
  });
});

describe('los textos de las sugerencias', () => {
  it('113. el aviso de desvío dice cuánto falta o sobra, y no dice nada si cuadra', () => {
    expect(avisoDeDesvio(0)).toBe('');
    expect(avisoDeDesvio(47)).toBe(' NO CUADRA: faltan 0.47€. Compruébalo antes de aceptar.');
    expect(avisoDeDesvio(-27)).toBe(' NO CUADRA: sobran 0.27€. Compruébalo antes de aceptar.');
  });

  it('114. la combinación de facturas enseña cada factura con su importe y proveedor, y la línea del banco', () => {
    const texto = textoComboFacturas({
      propia: { monto: 9.99, proveedor: 'Amazon EU' },
      otras: [{ numero: 12, monto: 5.98, proveedor: 'Sigma Team' }],
      linea: { importe: -15.97, concepto: 'AMAZON PAYMENTS' },
    });

    expect(texto).toBe('Esta factura (9.99€, Amazon EU) + la factura 12 (5.98€, Sigma Team) suman 15.97€, contra la línea de 15.97€ ("AMAZON PAYMENTS").');
  });

  it('115. si la combinación no cuadra al céntimo, el texto lo avisa', () => {
    const texto = textoComboFacturas({ propia: { monto: 9.99 }, otras: [{ numero: 12, monto: 5.98 }], linea: { importe: -16.44, concepto: 'X' } });

    expect(texto).toContain('NO CUADRA: faltan 0.47€');
  });

  it('116. la factura que cubre varios movimientos lista las fechas y los importes, y suma', () => {
    const movimientos = [{ fecha: '2026-09-14', importe: -8.5 }, { fecha: '2026-09-15', importe: -49.01 }];

    expect(textoCubreVarios({ propia: { monto: 57.51, proveedor: 'Bolt' }, movimientos }))
      .toBe('Esta factura (57.51€, Bolt) cubre 2 movimientos que suman 57.51€: 14/9 8.50€ · 15/9 49.01€.');
    expect(textoCubreVariosCorto({ numero: 46, proveedor: 'Bolt', movimientos })).toBe('factura 46 (Bolt) · 2 movimientos · 57.51€');
    expect(sumaDeMovimientos(movimientos)).toBe(57.51);
  });
});

describe('el excel del Openbank que llega disfrazado de HTML', () => {
  const html = `<!DOCTYPE html><html><body><table>
    <tr><th>Fecha operación</th><th>Fecha valor</th><th>Concepto</th><th>Importe</th><th>Saldo</th></tr>
    <tr><td>03/10/2026</td><td>04/10/2026</td><td>COMPRA MATERIAL</td><td>-12,50</td><td>1.000,00</td></tr>
    <tr><td>05/10/2026</td><td>06/10/2026</td><td>INGRESO SOCIO</td><td>30,00</td><td>1.030,00</td></tr>
    <tr><td>fila rara</td><td>sin fecha valor</td><td>X</td><td>1</td><td>2</td></tr>
  </table></body></html>`;

  it('117. se reconoce por su contenido, no por la extensión', () => {
    expect(esHtmlDisfrazadoDeExcel(Buffer.from(html, 'latin1'))).toBe(true);
    expect(esHtmlDisfrazadoDeExcel(Buffer.from('Fecha,Concepto\r\n1,2'))).toBe(false);
  });

  it('118. se convierte en una hoja con su cabecera, los importes con coma bien leídos y sin las filas raras', () => {
    const ws = convertirHtmlAWorkbook(Buffer.from(html, 'latin1')).getWorksheet('openbank');

    expect(ws.getRow(1).values.slice(1)).toEqual(['Fecha Operación', 'Fecha Valor', 'Concepto', 'Importe', 'Saldo']);
    expect(ws.rowCount).toBe(3);
    expect(ws.getRow(2).getCell(3).value).toBe('COMPRA MATERIAL');
    expect(ws.getRow(2).getCell(4).value).toBe(-12.5);
    expect(ws.getRow(2).getCell(5).value).toBe(1000);
    expect(ws.getRow(3).getCell(4).value).toBe(30);
  });

  it('119. un HTML sin ninguna fila de movimientos da un aviso claro', () => {
    expect(() => convertirHtmlAWorkbook(Buffer.from('<html><body><table><tr><td>nada</td></tr></table></body></html>')))
      .toThrow(/No se ha encontrado ninguna fila de movimientos/);
  });
});
