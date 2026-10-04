import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { limpiar, sembrarLinea, lector, facturaPorNombre, lineaPorId, MARCA } from './ayuda.js';
import { analizarFactura, procesarFacturaSubida, reintentarPendientes, confirmarMatch } from '../lib/facturaMatcher.cjs';
import { query } from '../lib/db.cjs';

beforeEach(limpiar);
afterAll(limpiar);

async function una(importe, proveedor, nombre) {
  const archivo = `${MARCA}${nombre}.pdf`;
  const analisis = await analizarFactura(Buffer.from(`${archivo}-${Math.random()}`), true, archivo, lector([{ importe, fecha: '2026-08-05', proveedor }]));
  await procesarFacturaSubida({ hoja: null, clave: null, rutaBlob: `https://ejemplo/${archivo}`, nombreOriginal: archivo, concepto: null, analisis });
  return { archivo };
}

const veredicto = async nombre => facturaPorNombre(`${MARCA}${nombre}.pdf`);

describe('lo exacto va antes que lo parecido', () => {
  it('53. dos facturas de proveedores distintos que suman justo una línea, aunque cada una se parezca a otra línea', async () => {
    const amazon = await sembrarLinea({ importe: -15.97, fecha: '2026-08-09', concepto: 'AMAZON PAYMENTS EUROPE' });
    await sembrarLinea({ importe: -10.46, fecha: '2026-07-08', concepto: 'PAGO GASOLINERAS' });
    await sembrarLinea({ importe: -5.71, fecha: '2026-10-02', concepto: 'COMPRA EN BOLT A' });
    await sembrarLinea({ importe: -6.90, fecha: '2026-09-14', concepto: 'COMPRA EN BOLT B' });

    await una(9.99, 'Amazon EU S.à r.l.', 'amazmix2');
    await una(5.98, 'Sigma Team GmbH', 'amazmix');
    await reintentarPendientes();

    for (const nombre of ['amazmix2', 'amazmix']) {
      const f = await veredicto(nombre);
      expect(f.motivo_tipo).toBe('combo_sugerido');
      expect(String(f.motivo_candidatos.movimientoId)).toBe(String(amazon.id));
      expect(f.motivo_candidatos.otrasFacturas).toHaveLength(1);
      expect(f.motivo_detalle).not.toContain('NO CUADRA');
    }
  });

  it('54. aceptar la combinación enlaza las dos facturas a la línea de Amazon y la resuelve', async () => {
    const amazon = await sembrarLinea({ importe: -15.97, fecha: '2026-08-09', concepto: 'AMAZON PAYMENTS EUROPE' });
    await sembrarLinea({ importe: -10.46, fecha: '2026-07-08', concepto: 'PAGO GASOLINERAS' });
    await una(9.99, 'Amazon EU S.à r.l.', 'amazmix2');
    await una(5.98, 'Sigma Team GmbH', 'amazmix');
    await reintentarPendientes();

    const f = await veredicto('amazmix2');
    const ids = [f.id, ...f.motivo_candidatos.otrasFacturas.map(o => o.id)];
    await confirmarMatch(Number(amazon.id), ids, 'amazon');

    expect((await lineaPorId(amazon.id)).estado).toBe('resuelta');
    const { rows } = await query(`SELECT factura_id FROM movimiento_facturas WHERE movimiento_id = $1`, [amazon.id]);
    expect(rows.map(r => Number(r.factura_id)).sort()).toEqual(ids.map(Number).sort());
  });

  it('55. si una línea ya cuadra exacta con la factura sola, manda esa, no la suma', async () => {
    const exacta = await sembrarLinea({ importe: -9.99, fecha: '2026-08-06', concepto: 'AMAZON SOLA' });
    await sembrarLinea({ importe: -15.97, fecha: '2026-08-09', concepto: 'AMAZON SUMA' });
    await una(9.99, 'Amazon EU S.à r.l.', 'amazmix2');
    await una(5.98, 'Sigma Team GmbH', 'amazmix');
    await reintentarPendientes();

    const f = await veredicto('amazmix2');
    expect(f.motivo_tipo).toBe('ambiguo');
    expect(String(f.motivo_candidatos.candidatos[0].movimientoId)).toBe(String(exacta.id));
  });

  it('56. sin nada exacto, sigue proponiendo la línea parecida con su aviso', async () => {
    await sembrarLinea({ importe: -10.46, fecha: '2026-07-08', concepto: 'PAGO GASOLINERAS' });
    await una(9.99, 'Amazon EU S.à r.l.', 'amazmix2');
    await reintentarPendientes();

    const f = await veredicto('amazmix2');
    expect(f.motivo_tipo).toBe('ambiguo');
    expect(f.motivo_detalle).toContain('NO CUADRA: faltan 0.47€');
  });

  it('57. una factura ya emparejada no se vuelve a sumar con otra pendiente', async () => {
    const linea = await sembrarLinea({ importe: -9.99, fecha: '2026-08-06', concepto: 'AMAZON SOLA' });
    await sembrarLinea({ importe: -15.97, fecha: '2026-08-09', concepto: 'AMAZON SUMA' });
    const { archivo } = await una(9.99, 'Amazon EU S.à r.l.', 'ya');
    const hecha = await facturaPorNombre(archivo);
    await confirmarMatch(Number(linea.id), [hecha.id], 'amazon');
    await una(5.98, 'Sigma Team GmbH', 'amazmix');
    await reintentarPendientes();

    const f = await veredicto('amazmix');
    expect(f.motivo_tipo).not.toBe('combo_sugerido');
  });
});
