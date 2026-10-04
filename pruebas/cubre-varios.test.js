import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { limpiar, sembrarLinea, lector, facturaPorNombre, lineaPorId, MARCA, HOJA } from './ayuda.js';
import { analizarFactura, procesarFacturaSubida, cubrirMovimientos, confirmarMatch, confirmarDatosManual } from '../lib/facturaMatcher.cjs';
import { subconjuntosExactos, claveDeCubre } from '../lib/cubreVarios.cjs';
import { construirProveedores } from '../lib/agrupador.cjs';
import { facturasDeMovimientos } from '../lib/exportar.cjs';
import { GET as listarFacturas } from '../app/api/facturas/route.js';
import { POST as rechazarSugerencia } from '../app/api/sugerencias/rechazar/route.js';
import { query } from '../lib/db.cjs';

const limpiarTodo = async () => {
  await limpiar();
  await query(`DELETE FROM sugerencias_rechazadas WHERE hoja = $1`, [HOJA]);
};
beforeEach(limpiarTodo);
afterAll(limpiarTodo);

const BOLT = [8.50, 6.90, 24.90, 11.50, 5.71];
let contador = 0;

async function sembrarBolt(importes = BOLT) {
  const lineas = [];
  for (const [i, importe] of importes.entries()) {
    lineas.push(await sembrarLinea({ importe: -importe, fecha: `2026-09-${String(10 + i).padStart(2, '0')}`, concepto: `COMPRA EN BOLT ${i}` }));
  }
  return lineas;
}

async function subirSuelta(importe, { proveedor = 'Bolt Operations', fecha = '2026-10-01' } = {}) {
  contador++;
  const nombre = `${MARCA}cubre-${contador}.pdf`;
  const analisis = await analizarFactura(Buffer.from(`${nombre}-${Math.random()}`), true, nombre, lector([{ importe, fecha, proveedor }]));
  const resultado = await procesarFacturaSubida({
    hoja: null, clave: null, rutaBlob: `https://ejemplo/${nombre}`, nombreOriginal: nombre, concepto: 'viajes', analisis,
  });
  return { resultado, factura: await facturaPorNombre(nombre), nombre };
}

const enlaces = async facturaId => (await query(
  `SELECT movimiento_id, cubre FROM movimiento_facturas WHERE factura_id = $1 ORDER BY movimiento_id`, [facturaId]
)).rows;

describe('buscar los subconjuntos que suman justo', () => {
  const items = lista => lista.map((centimos, i) => ({ id: i + 1, centimos }));

  it('32. encuentra el único conjunto de dos o más que suma justo', () => {
    const r = subconjuntosExactos(items([850, 690, 2490, 1150, 571, 3333]), 5751);
    expect(r).toHaveLength(1);
    expect(r[0].map(i => i.centimos).sort((a, b) => a - b)).toEqual([571, 690, 850, 1150, 2490]);
  });

  it('33. si hay dos formas distintas de sumar lo mismo, las devuelve las dos (es ambiguo)', () => {
    expect(subconjuntosExactos(items([1000, 2000, 1500, 1500]), 3000)).toHaveLength(2);
  });

  it('34. un solo elemento que ya suma justo no cuenta: hace falta juntar al menos dos', () => {
    expect(subconjuntosExactos(items([5751, 100]), 5751)).toEqual([]);
  });
});

describe('la propuesta: una factura que cubre varios movimientos', () => {
  it('35. cinco movimientos del mismo grupo que suman lo que la factura: se propone, sin enlazar nada', async () => {
    const lineas = await sembrarBolt();
    const { resultado, factura } = await subirSuelta(57.51);

    expect(resultado.tipo).toBe('cubre_varios');
    expect(resultado.movimientoIds).toEqual(lineas.map(l => Number(l.id)));
    expect(resultado.detalle).toContain('cubre 5 movimientos que suman 57.51€');
    expect(factura.estado).toBe('revisar');
    expect(factura.motivo_candidatos.movimientoIds).toEqual(lineas.map(l => Number(l.id)));
    expect(await enlaces(factura.id)).toEqual([]);
    for (const l of lineas) expect((await lineaPorId(l.id)).estado).toBe('sin_resolver');
  });

  it('36. con otro movimiento suelto en el grupo, propone solo los que suman justo', async () => {
    const lineas = await sembrarBolt();
    const extra = await sembrarLinea({ importe: -33.33, fecha: '2026-09-20', concepto: 'COMPRA EN BOLT EXTRA' });
    const { resultado } = await subirSuelta(57.51);

    expect(resultado.tipo).toBe('cubre_varios');
    expect(resultado.movimientoIds).not.toContain(Number(extra.id));
    expect(resultado.movimientoIds).toHaveLength(lineas.length);
  });

  it('37. si la suma falla por un céntimo, no propone nada', async () => {
    await sembrarBolt();
    const { resultado } = await subirSuelta(57.50);
    expect(resultado.tipo).not.toBe('cubre_varios');
  });

  it('38. si hay dos combinaciones posibles, no adivina', async () => {
    await sembrarBolt([10, 20, 15, 15]);
    const { resultado } = await subirSuelta(30);
    expect(resultado.tipo).not.toBe('cubre_varios');
  });

  it('39. si un solo movimiento ya cuadra al céntimo, manda ese, no la suma', async () => {
    const lineas = await sembrarBolt([57.51, 8.50, 49.01]);
    const { resultado } = await subirSuelta(57.51);

    expect(resultado.tipo).toBe('ambiguo');
    expect(String(resultado.candidatos[0].movimientoId)).toBe(String(lineas[0].id));
  });

  it('40. movimientos de grupos distintos no se suman entre sí', async () => {
    const lineas = await sembrarBolt();
    await query(`UPDATE movimientos SET clave = 'otro grupo' WHERE id = ANY($1::bigint[])`, [[lineas[3].id, lineas[4].id]]);
    const { resultado } = await subirSuelta(57.51);
    expect(resultado.tipo).not.toBe('cubre_varios');
  });
});

describe('aceptar la propuesta', () => {
  it('41. enlaza la factura a los cinco, los resuelve, y ella queda emparejada', async () => {
    const lineas = await sembrarBolt();
    const { resultado, factura } = await subirSuelta(57.51);

    await cubrirMovimientos(factura.id, resultado.movimientoIds, 'viajes');

    expect((await enlaces(factura.id)).map(e => [Number(e.movimiento_id), e.cubre]))
      .toEqual(lineas.map(l => [Number(l.id), true]));
    for (const l of lineas) {
      const m = await lineaPorId(l.id);
      expect(m.estado).toBe('resuelta');
      expect(m.nota_final).toBe('viajes');
    }
    expect((await facturaPorNombre(factura.nombre_original)).estado).toBe('matcheada');

    const revisada = await confirmarDatosManual(factura.id, { concepto: 'viajes' });
    expect(revisada.tipo).toBe('emparejada_ok');
    expect(revisada.detalle).toContain('cubre 5 movimientos');
  });

  it('42. si no suman justo, no cambia nada de nada', async () => {
    const lineas = await sembrarBolt();
    const { resultado, factura } = await subirSuelta(57.51);

    await expect(cubrirMovimientos(factura.id, resultado.movimientoIds.slice(0, 4))).rejects.toMatchObject({ status: 409 });

    expect(await enlaces(factura.id)).toEqual([]);
    for (const l of lineas) expect((await lineaPorId(l.id)).estado).toBe('sin_resolver');
    expect((await facturaPorNombre(factura.nombre_original)).estado).toBe('revisar');
  });

  it('43. no deja enlazar si algún movimiento ya no está pendiente, ni si son de otro grupo', async () => {
    const lineas = await sembrarBolt();
    const { resultado, factura } = await subirSuelta(57.51);

    await query(`UPDATE movimientos SET estado = 'resuelta' WHERE id = $1`, [lineas[0].id]);
    await expect(cubrirMovimientos(factura.id, resultado.movimientoIds)).rejects.toMatchObject({ status: 409 });
    await query(`UPDATE movimientos SET estado = 'sin_resolver' WHERE id = $1`, [lineas[0].id]);

    await query(`UPDATE movimientos SET clave = 'otro grupo' WHERE id = $1`, [lineas[1].id]);
    await expect(cubrirMovimientos(factura.id, resultado.movimientoIds)).rejects.toMatchObject({ status: 409 });

    expect(await enlaces(factura.id)).toEqual([]);
  });

  it('44. una factura que ya está enlazada no puede cubrir otros movimientos', async () => {
    const lineas = await sembrarBolt();
    const { resultado, factura } = await subirSuelta(57.51);
    await cubrirMovimientos(factura.id, resultado.movimientoIds);

    const otras = [await sembrarLinea({ importe: -20 }), await sembrarLinea({ importe: -37.51 })];
    await expect(cubrirMovimientos(factura.id, otras.map(l => l.id))).rejects.toMatchObject({ status: 409 });
    expect(await enlaces(factura.id)).toHaveLength(lineas.length);
  });

  it('45. los caminos de siempre siguen sin poder enlazar una factura a dos movimientos', async () => {
    const [a, b, c] = [
      await sembrarLinea({ importe: -10 }),
      await sembrarLinea({ importe: -10, estado: 'ignorada' }),
      await sembrarLinea({ importe: -10, estado: 'ignorada' }),
    ];
    const { factura } = await subirSuelta(10);

    await confirmarMatch(Number(a.id), [factura.id], 'x');
    await expect(query(
      `INSERT INTO movimiento_facturas (movimiento_id, factura_id) VALUES ($1, $2)`, [b.id, factura.id]
    )).rejects.toThrow(/movimiento_facturas_una_por_factura_simple|duplicate key/);

    const lineas = await sembrarBolt();
    const { resultado, factura: grande } = await subirSuelta(57.51);
    await cubrirMovimientos(grande.id, resultado.movimientoIds);
    await expect(confirmarMatch(Number(c.id), [grande.id], 'x')).rejects.toMatchObject({ status: 409 });
    expect(await enlaces(grande.id)).toHaveLength(lineas.length);
  });
});

describe('cómo se ve en las pantallas', () => {
  const buscar = async nombre => (await (await listarFacturas()).json()).facturas.filter(f => f.nombre_original === nombre);

  it('46. Facturas: la propuesta trae los datos de los movimientos; ya enlazada sale una sola fila', async () => {
    await sembrarBolt();
    const { resultado, factura, nombre } = await subirSuelta(57.51);

    const [antes] = await buscar(nombre);
    expect(antes.motivo_candidatos.movimientosDatos).toHaveLength(5);
    expect(antes.motivo_candidatos.hoja).toBe(HOJA);

    await cubrirMovimientos(factura.id, resultado.movimientoIds);
    const despues = await buscar(nombre);
    expect(despues).toHaveLength(1);
    expect(Number(despues[0].movimientos_cubiertos)).toBe(5);
    expect(Number(despues[0].movimientos_suma)).toBe(57.51);
  });

  it('47. Facturas: si un movimiento se resuelve por otro lado, la propuesta caduca', async () => {
    const lineas = await sembrarBolt();
    const { nombre } = await subirSuelta(57.51);
    await query(`UPDATE movimientos SET estado = 'resuelta' WHERE id = $1`, [lineas[2].id]);

    const [f] = await buscar(nombre);
    expect(f.motivo_candidatos).toBeNull();
  });

  it('48. Movimientos: el grupo lleva la factura que lo cubre, y la ✕ la descarta para siempre', async () => {
    const lineas = await sembrarBolt();
    const { resultado, factura } = await subirSuelta(57.51);

    const grupoDe = async () => (await construirProveedores()).find(g => g.movimientos.some(m => String(m.id) === String(lineas[0].id)));
    const grupo = await grupoDe();
    expect(grupo.cubren).toHaveLength(1);
    expect(grupo.cubren[0].facturaId).toBe(factura.id);
    expect(grupo.cubren[0].movimientoIds).toEqual(resultado.movimientoIds);
    expect(grupo.cubren[0].texto).toContain('5 movimientos');

    const r = await rechazarSugerencia(new Request('http://pruebas/', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hoja: HOJA, clave: 'pruebas', tipo: 'cubre', valor: grupo.cubren[0].valor }),
    }));
    expect(r.status).toBe(200);
    expect((await grupoDe()).cubren).toBeUndefined();
    expect(claveDeCubre(factura.id, resultado.movimientoIds)).toBe(grupo.cubren[0].valor);
  });
});

describe('el envío a la gestoría', () => {
  it('49. una factura que cubre cinco movimientos viaja una sola vez', async () => {
    await sembrarBolt();
    const { resultado, factura } = await subirSuelta(57.51);
    await cubrirMovimientos(factura.id, resultado.movimientoIds);

    const viajan = await facturasDeMovimientos(resultado.movimientoIds);
    expect(viajan).toHaveLength(1);
    expect(viajan[0].id).toBe(factura.id);
  });
});
