import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { limpiar, subir, sembrarLinea, lector, facturaPorNombre, lineaPorId, marcarComoDeLote } from './ayuda.js';
import { confirmarMatch, confirmarDatosManual, reintentarPendientes } from '../lib/facturaMatcher.cjs';
import { query } from '../lib/db.cjs';

beforeEach(limpiar);
afterAll(limpiar);

const unaDe = importe => lector([{ importe, fecha: '2026-07-19', proveedor: 'Proveedor' }]);
// La línea que propone el resultado, se llame como se llame la propuesta.
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

    // Se propone: es lo que ella pidió, "que me lo proponga, no que valide".
    expect(String(lineaPropuesta(resultado))).toBe(String(linea.id));
    // Pero no se da por bueno ni se toca nada.
    expect((await lineaPorId(linea.id)).estado).toBe('sin_resolver');
    expect((await facturaPorNombre(archivo)).estado).not.toBe('matcheada');
    expect(resultado.exacto).toBe(false);
    // Y el aviso dice cuánto falta, no se lo calla.
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
    // Movimientos solo dibuja las propuestas guardadas como combinación y con
    // la línea dentro. Si se guarda de otra forma, esa línea parece vacía.
    const f = await facturaPorNombre(archivo);
    expect(f.motivo_tipo).toBe('combo_sugerido');
    expect(String(f.motivo_candidatos.movimientoId)).toBe(String(linea.id));
  });

  it('17. la factura que paga un colaborador de su bolsillo no se cruza', async () => {
    const linea = await sembrarLinea({ importe: -45 });
    // Lo que la distingue es que la pague el (que viva en un lote), NO quien la
    // sube: la propia usuaria esta dada de alta y sube casi todas.
    const { archivo } = await subir({ leer: unaDe(45) });
    await marcarComoDeLote(archivo);

    // Escribirle el importe a mano vuelve a cruzarla: aqui es donde se ve.
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
