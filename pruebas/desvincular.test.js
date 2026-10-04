import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { limpiar, sembrarLinea, lector, facturaPorNombre, lineaPorId, marcarComoDeLote, MARCA, HOJA } from './ayuda.js';
import { analizarFactura, procesarFacturaSubida, confirmarMatch, cubrirMovimientos, desvincularFactura } from '../lib/facturaMatcher.cjs';
import { POST as desvincular } from '../app/api/facturas/[id]/desvincular/route.js';
import { query } from '../lib/db.cjs';

const limpiarTodo = async () => {
  await limpiar();
  await query(`DELETE FROM sugerencias_rechazadas WHERE hoja = $1`, [HOJA]);
};
beforeEach(limpiarTodo);
afterAll(limpiarTodo);

let contador = 0;
async function subirSuelta(importe, proveedor = 'Proveedor de prueba') {
  contador++;
  const nombre = `${MARCA}desvincular-${contador}.pdf`;
  const analisis = await analizarFactura(Buffer.from(`${nombre}-${Math.random()}`), true, nombre, lector([{ importe, fecha: '2026-10-01', proveedor }]));
  await procesarFacturaSubida({ hoja: null, clave: null, rutaBlob: `https://ejemplo/${nombre}`, nombreOriginal: nombre, concepto: 'material', analisis });
  return facturaPorNombre(nombre);
}

const enlacesDe = async facturaId => (await query(
  `SELECT movimiento_id, cubre FROM movimiento_facturas WHERE factura_id = $1 ORDER BY movimiento_id`, [facturaId]
)).rows;

const llamarRuta = (facturaId, cuerpo) => desvincular(
  new Request('http://pruebas/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) }),
  { params: Promise.resolve({ id: String(facturaId) }) }
);

describe('desvincular una factura de su línea', () => {
  it('58. la línea vuelve a pendiente sin su nota, y la factura se queda viva con su archivo y vuelve a buscar línea', async () => {
    const linea = await sembrarLinea({ importe: -45, fecha: '2026-09-20' });
    const factura = await subirSuelta(45);
    await confirmarMatch(Number(linea.id), [factura.id], 'material');
    expect((await facturaPorNombre(factura.nombre_original)).estado).toBe('matcheada');

    await desvincularFactura(factura.id, Number(linea.id));

    const m = await lineaPorId(linea.id);
    expect(m.estado).toBe('sin_resolver');
    expect(m.nota_final).toBeNull();
    expect(await enlacesDe(factura.id)).toEqual([]);

    const f = await facturaPorNombre(factura.nombre_original);
    expect(f.estado).not.toBe('matcheada');
    expect(f.ruta_blob).toBe(factura.ruta_blob);
    expect(f.motivo_tipo).toBe('ambiguo');
    expect(String(f.motivo_candidatos.candidatos[0].movimientoId)).toBe(String(linea.id));
  });

  it('59. si la línea tenía dos facturas, solo se quita la elegida y la línea sigue resuelta con la otra', async () => {
    const linea = await sembrarLinea({ importe: -51.05, fecha: '2026-09-20' });
    const a = await subirSuelta(45);
    const b = await subirSuelta(6.05);
    await confirmarMatch(Number(linea.id), [a.id, b.id], 'material');

    await desvincularFactura(a.id, Number(linea.id));

    expect(await enlacesDe(a.id)).toEqual([]);
    expect((await enlacesDe(b.id)).map(e => Number(e.movimiento_id))).toEqual([Number(linea.id)]);
    expect((await lineaPorId(linea.id)).estado).toBe('resuelta');
    expect((await facturaPorNombre(b.nombre_original)).estado).toBe('matcheada');
  });

  it('60. una factura que cubre cinco movimientos los suelta los cinco, desde cualquiera de ellos', async () => {
    const importes = [8.50, 6.90, 24.90, 11.50, 5.71];
    const lineas = [];
    for (const [i, importe] of importes.entries()) {
      lineas.push(await sembrarLinea({ importe: -importe, fecha: `2026-09-${String(10 + i).padStart(2, '0')}`, concepto: `COMPRA EN BOLT ${i}` }));
    }
    const factura = await subirSuelta(57.51, 'Bolt Operations');
    await cubrirMovimientos(factura.id, lineas.map(l => Number(l.id)), 'viajes');
    expect(await enlacesDe(factura.id)).toHaveLength(5);

    await desvincularFactura(factura.id, Number(lineas[2].id));

    expect(await enlacesDe(factura.id)).toEqual([]);
    for (const l of lineas) {
      const m = await lineaPorId(l.id);
      expect(m.estado).toBe('sin_resolver');
      expect(m.nota_final).toBeNull();
    }
    const f = await facturaPorNombre(factura.nombre_original);
    expect(f.estado).toBe('revisar');
    expect(f.motivo_tipo).toBe('cubre_varios');
  });

  it('61. si el enlace ya no existe, avisa y no cambia nada', async () => {
    const linea = await sembrarLinea({ importe: -45, fecha: '2026-09-20' });
    const otra = await sembrarLinea({ importe: -30, fecha: '2026-09-21' });
    const factura = await subirSuelta(45);
    await confirmarMatch(Number(linea.id), [factura.id], 'material');

    await expect(desvincularFactura(factura.id, Number(otra.id))).rejects.toMatchObject({ status: 409 });

    expect((await enlacesDe(factura.id)).map(e => Number(e.movimiento_id))).toEqual([Number(linea.id)]);
    expect((await lineaPorId(linea.id)).estado).toBe('resuelta');
    expect((await facturaPorNombre(factura.nombre_original)).estado).toBe('matcheada');
  });

  it('62. la factura de un colaborador no se desvincula por aquí', async () => {
    const linea = await sembrarLinea({ importe: -45, fecha: '2026-09-20' });
    const factura = await subirSuelta(45);
    await confirmarMatch(Number(linea.id), [factura.id], 'material');
    await marcarComoDeLote(factura.nombre_original);

    await expect(desvincularFactura(factura.id, Number(linea.id))).rejects.toMatchObject({ status: 409 });

    expect(await enlacesDe(factura.id)).toHaveLength(1);
    expect((await lineaPorId(linea.id)).estado).toBe('resuelta');
  });

  it('63. una factura desvinculada se puede enlazar a otra línea sin chocar con la regla de una factura = un movimiento', async () => {
    const mala = await sembrarLinea({ importe: -45, fecha: '2026-09-20', concepto: 'LINEA EQUIVOCADA' });
    const buena = await sembrarLinea({ importe: -45, fecha: '2026-09-25', concepto: 'LINEA BUENA' });
    const factura = await subirSuelta(45);
    await confirmarMatch(Number(mala.id), [factura.id], 'material');

    await desvincularFactura(factura.id, Number(mala.id));
    await confirmarMatch(Number(buena.id), [factura.id], 'material');

    expect((await enlacesDe(factura.id)).map(e => Number(e.movimiento_id))).toEqual([Number(buena.id)]);
    expect((await lineaPorId(buena.id)).estado).toBe('resuelta');
    expect((await lineaPorId(mala.id)).estado).toBe('sin_resolver');
  });
});

describe('la ruta de desvincular', () => {
  it('64. responde ok y desvincula', async () => {
    const linea = await sembrarLinea({ importe: -45, fecha: '2026-09-20' });
    const factura = await subirSuelta(45);
    await confirmarMatch(Number(linea.id), [factura.id], 'material');

    const respuesta = await llamarRuta(factura.id, { movimientoId: linea.id });

    expect(respuesta.status).toBe(200);
    expect(await respuesta.json()).toEqual({ ok: true });
    expect(await enlacesDe(factura.id)).toEqual([]);
  });

  it('65. si no se puede, devuelve el error con su código y el mensaje', async () => {
    const linea = await sembrarLinea({ importe: -45, fecha: '2026-09-20' });
    const factura = await subirSuelta(45);

    const respuesta = await llamarRuta(factura.id, { movimientoId: linea.id });

    expect(respuesta.status).toBe(409);
    expect((await respuesta.json()).error).toContain('ya no está enlazada');
  });
});
