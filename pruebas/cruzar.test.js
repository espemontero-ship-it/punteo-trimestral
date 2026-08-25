import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { limpiar, subir, sembrarLinea, lector, facturaPorNombre, lineaPorId, marcarComoDeLote } from './ayuda.js';
import { confirmarMatch, confirmarDatosManual, reintentarPendientes } from '../lib/facturaMatcher.cjs';
import { query } from '../lib/db.cjs';

beforeEach(limpiar);
afterAll(limpiar);

const unaDe = importe => lector([{ importe, fecha: '2026-07-19', proveedor: 'Proveedor' }]);

const lineaPropuesta = r => r.movimientoId ?? r.candidatos?.[0]?.movimientoId ?? null;

describe('cruzar facturas con el banco', () => {
  it('9. nada se empareja solo: la línea sigue pendiente y queda una sugerencia', async () => {
    const linea = await sembrarLinea({ importe: -45 });
    const { archivo, resultado } = await subir({ leer: unaDe(45) });

    expect((await lineaPorId(linea.id)).estado).toBe('sin_resolver');
    expect((await facturaPorNombre(archivo)).estado).not.toBe('matcheada');
    expect(String(lineaPropuesta(resultado))).toBe(String(linea.id));
  });

  it('10. al aceptar la sugerencia, la línea queda resuelta y la factura emparejada', async () => {
    const linea = await sembrarLinea({ importe: -45 });
    const { archivo } = await subir({ leer: unaDe(45) });
    const f = await facturaPorNombre(archivo);

    await confirmarMatch(linea.id, [f.id], 'nota de prueba');

    expect((await lineaPorId(linea.id)).estado).toBe('resuelta');
    expect((await facturaPorNombre(archivo)).estado).toBe('matcheada');
  });

  it('11. una factura de gasto busca gastos; una rectificativa busca ingresos', async () => {
    const gasto = await sembrarLinea({ importe: -45, concepto: 'GASTO DE PRUEBA' });
    const ingreso = await sembrarLinea({ importe: 45, concepto: 'INGRESO DE PRUEBA' });

    const compra = await subir({ leer: unaDe(45) });
    expect(String(lineaPropuesta(compra.resultado))).toBe(String(gasto.id));

    const rectificativa = await subir({ leer: unaDe(-45) });
    expect(String(lineaPropuesta(rectificativa.resultado))).toBe(String(ingreso.id));
  });

  it('12. se compara la suma del archivo, no su número más grande', async () => {
    const linea = await sembrarLinea({ importe: -43.78 });
    const { resultado } = await subir({
      leer: lector([
        { importe: 22.79, fecha: '2026-07-19', proveedor: 'Amazon' },
        { importe: 20.99, fecha: '2026-07-19', proveedor: 'Amazon' },
      ]),
    });
    expect(String(lineaPropuesta(resultado))).toBe(String(linea.id));
  });

  it('13. lo que no cuadra al céntimo se propone, pero diciendo cuánto se desvía', async () => {
    const linea = await sembrarLinea({ importe: -45.01 });
    const { archivo, resultado } = await subir({ leer: unaDe(45) });

    expect(String(lineaPropuesta(resultado))).toBe(String(linea.id));

    expect((await lineaPorId(linea.id)).estado).toBe('sin_resolver');
    expect((await facturaPorNombre(archivo)).estado).not.toBe('matcheada');
    expect(resultado.exacto).toBe(false);

    expect(resultado.detalle).toMatch(/NO CUADRA/);
    expect(resultado.detalle).toMatch(/0,01|0.01/);
  });

  it('13b. una diferencia mayor de un euro no se propone', async () => {
    const linea = await sembrarLinea({ importe: -46.5 });
    const { resultado } = await subir({ leer: unaDe(45) });

    expect(lineaPropuesta(resultado)).toBeNull();
  });

  it('14. cambiar el importe a mano vuelve a calcular la propuesta', async () => {
    const linea = await sembrarLinea({ importe: -77 });
    const { archivo } = await subir({ leer: unaDe(45) });
    const f = await facturaPorNombre(archivo);

    const resultado = await confirmarDatosManual(f.id, { importe: 77 });
    expect(String(lineaPropuesta(resultado))).toBe(String(linea.id));
  });

  it('14b. subir el excel del banco vuelve a calcular las propuestas', async () => {
    const { archivo } = await subir({ leer: unaDe(66) });
    const linea = await sembrarLinea({ importe: -66 });

    await reintentarPendientes();

    const f = await facturaPorNombre(archivo);
    expect(f.motivo_candidatos ?? f.motivo_tipo).toBeTruthy();
    expect((await lineaPorId(linea.id)).estado).toBe('sin_resolver');
  });

  it('15. una factura no puede colgar de dos movimientos', async () => {
    const primera = await sembrarLinea({ importe: -45 });
    const segunda = await sembrarLinea({ importe: -45, concepto: 'OTRA LINEA' });
    const { archivo } = await subir({ leer: unaDe(45) });
    const f = await facturaPorNombre(archivo);

    await confirmarMatch(primera.id, [f.id], 'la buena');
    await expect(
      query('INSERT INTO movimiento_facturas (movimiento_id, factura_id) VALUES ($1, $2)', [segunda.id, f.id])
    ).rejects.toThrow();
  });

  it('16. si el banco cobró solo algunas facturas del archivo, se propone esa suma', async () => {
    const linea = await sembrarLinea({ importe: -30 });
    const { resultado } = await subir({
      leer: lector([
        { importe: 10, fecha: '2026-07-19', proveedor: 'X' },
        { importe: 20, fecha: '2026-07-19', proveedor: 'X' },
        { importe: 55, fecha: '2026-07-19', proveedor: 'X' },
      ]),
    });
    expect(String(lineaPropuesta(resultado))).toBe(String(linea.id));
  });

  it('16b. la propuesta de varias facturas dentro también se ve desde Movimientos', async () => {
    const linea = await sembrarLinea({ importe: -30 });
    const { archivo } = await subir({
      leer: lector([
        { importe: 10, fecha: '2026-07-19', proveedor: 'X' },
        { importe: 20, fecha: '2026-07-19', proveedor: 'X' },
        { importe: 55, fecha: '2026-07-19', proveedor: 'X' },
      ]),
    });

    const f = await facturaPorNombre(archivo);
    expect(f.motivo_tipo).toBe('combo_sugerido');
    expect(String(f.motivo_candidatos.movimientoId)).toBe(String(linea.id));
  });

  it('16c. la propuesta de combinar dos facturas dice el proveedor de cada una y el concepto del banco', async () => {
    const linea = await sembrarLinea({ importe: -137.53, concepto: 'COMPRA TARJETA COMERCIO' });
    const { archivo: primera } = await subir({
      leer: lector([{ importe: 100.02, fecha: '2026-07-19', proveedor: 'Amazon' }]),
    });
    const { archivo: segunda } = await subir({
      leer: lector([{ importe: 37.51, fecha: '2026-07-19', proveedor: 'Correos' }]),
    });
    await query('UPDATE facturas SET proveedor_clave = NULL WHERE nombre_original IN ($1, $2)', [primera, segunda]);

    await reintentarPendientes();

    const a = await facturaPorNombre(primera);
    const b = await facturaPorNombre(segunda);
    expect(a.motivo_tipo).toBe('combo_sugerido');
    expect(String(a.motivo_candidatos.movimientoId)).toBe(String(linea.id));
    expect(a.motivo_detalle).toBe(
      `Esta factura (100.02€, Amazon) + la factura ${b.numero} (37.51€, Correos) suman 137.53€,`
      + ` contra la línea de 137.53€ ("COMPRA TARJETA COMERCIO").`
    );
  });

  it('17. la factura que paga un colaborador de su bolsillo no se cruza', async () => {
    const linea = await sembrarLinea({ importe: -45 });

    const { archivo } = await subir({ leer: unaDe(45) });
    await marcarComoDeLote(archivo);

    const f0 = await facturaPorNombre(archivo);
    const resultado = await confirmarDatosManual(f0.id, { importe: 45 });
    expect(resultado.tipo).toBe('no_se_cruza');
    expect((await lineaPorId(linea.id)).estado).toBe('sin_resolver');
  });

  it('17b. una factura subida por ella misma SI se cruza', async () => {
    const linea = await sembrarLinea({ importe: -45 });
    const { archivo, resultado } = await subir({ leer: unaDe(45), subidoPor: 1 });

    expect(String(lineaPropuesta(resultado))).toBe(String(linea.id));
    expect((await facturaPorNombre(archivo)).motivo_tipo).not.toBe('no_se_cruza');
  });
});
