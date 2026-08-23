import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { limpiar, subir, facturaPorNombre, lector, lectorRoto } from './ayuda.js';
import { importeDeFactura } from '../lib/facturaMatcher.cjs';

beforeEach(limpiar);
afterAll(limpiar);

describe('leer una factura', () => {
  it('1. un archivo con dos facturas guarda dos totales, y el importe es su suma', async () => {
    const { archivo } = await subir({
      leer: lector([
        { importe: 22.79, fecha: '2026-07-19', proveedor: 'Amazon' },
        { importe: 20.99, fecha: '2026-07-19', proveedor: 'Amazon' },
      ]),
    });
    const f = await facturaPorNombre(archivo);
    expect(f.totales.map(Number)).toEqual([22.79, 20.99]);
    expect(importeDeFactura(f)).toBe(43.78);
  });

  it('2. un archivo con una factura guarda un total', async () => {
    const { archivo } = await subir({
      leer: lector([{ importe: 45, fecha: '2026-07-19', proveedor: 'Decathlon' }]),
    });
    const f = await facturaPorNombre(archivo);
    expect(f.totales.map(Number)).toEqual([45]);
    expect(importeDeFactura(f)).toBe(45);
  });

  it('2b. se guardan el proveedor y la fecha de la factura', async () => {
    const { archivo } = await subir({
      leer: lector([{ importe: 45, fecha: '2026-07-19', proveedor: 'Decathlon' }]),
    });
    const f = await facturaPorNombre(archivo);
    expect(f.proveedor).toBe('Decathlon');
    expect(f.fecha_texto).toBe('2026-07-19');
  });

  it('3. una rectificativa guarda su importe en negativo', async () => {
    const { archivo } = await subir({
      leer: lector([{ importe: -30, fecha: '2026-07-19', proveedor: 'Decathlon' }]),
    });
    const f = await facturaPorNombre(archivo);
    expect(f.totales.map(Number)).toEqual([-30]);
    expect(importeDeFactura(f)).toBe(-30);
  });

  it('4. si la IA falla, la factura se guarda sin importe y se dice por qué', async () => {
    const { archivo, resultado } = await subir({
      leer: lectorRoto('your credit balance is too low'),
    });
    const f = await facturaPorNombre(archivo);
    expect(f).not.toBeNull();
    expect(importeDeFactura(f)).toBeNull();
    expect(resultado.detalle).toMatch(/saldo/i);
  });
});
