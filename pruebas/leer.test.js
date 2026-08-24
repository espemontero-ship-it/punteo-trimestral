import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { limpiar, subir, facturaPorNombre, lector, lectorRoto } from './ayuda.js';
import { importeDeFactura } from '../lib/facturaMatcher.cjs';
import { facturasDeLaRespuesta } from '../lib/facturaIA.cjs';
import { POST as ponerImporte } from '../app/api/facturas/[id]/importe/route.js';
import { POST as ponerDatos } from '../app/api/facturas/[id]/datos/route.js';

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

  it('3b. la lectura de la IA no tira los negativos por el camino', () => {

    const leidas = facturasDeLaRespuesta({
      legible: true,
      facturas: [{ importe: -30 }, { importe: 0 }, { importe: 45 }],
    });
    expect(leidas.map(f => f.importe)).toEqual([-30, 45]);
  });

  it('3c. el importe negativo se puede escribir a mano', async () => {
    const { archivo } = await subir({
      leer: lector([{ importe: 45, fecha: '2026-07-19', proveedor: 'Decathlon' }]),
    });
    const f = await facturaPorNombre(archivo);

    const peticion = cuerpo => new Request('http://pruebas/', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo),
    });
    const params = { params: Promise.resolve({ id: String(f.id) }) };

    const r1 = await ponerImporte(peticion({ importe: -30 }), params);
    expect(r1.status).not.toBe(400);
    expect(importeDeFactura(await facturaPorNombre(archivo))).toBe(-30);

    const r2 = await ponerDatos(peticion({ importe: -12.5 }), params);
    expect(r2.status).not.toBe(400);
    expect(importeDeFactura(await facturaPorNombre(archivo))).toBe(-12.5);

    const r3 = await ponerImporte(peticion({ importe: 0 }), params);
    expect(r3.status).toBe(400);
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
