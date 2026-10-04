import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { limpiar, sembrarLinea, lineaPorId, HOJA } from './ayuda.js';
import { POST as confirmar } from '../app/api/movimientos/[id]/confirmar/route.js';
import { POST as cambiarEstado } from '../app/api/movimientos/[id]/estado/route.js';
import { POST as guardarProveedor } from '../app/api/movimientos/[id]/proveedor/route.js';
import { POST as asignarProyecto } from '../app/api/movimientos/[id]/proyecto/route.js';
import { POST as marcarDevolucion } from '../app/api/movimientos/[id]/devolucion/route.js';
import { POST as vincularPago } from '../app/api/movimientos/[id]/vincular-pago/route.js';
import { POST as desvincularPago } from '../app/api/pagos/[id]/desvincular/route.js';
import { POST as confirmarGrupo } from '../app/api/proveedores/confirmar-grupo/route.js';
import { POST as pendienteGrupo } from '../app/api/proveedores/pendiente/route.js';
import { POST as proveedorGrupo } from '../app/api/proveedores/proveedor-grupo/route.js';
import { POST as proyectoGrupo } from '../app/api/proveedores/proyecto-grupo/route.js';
import { GET as resumen } from '../app/api/resumen/route.js';
import { POST as recalcularClaves } from '../app/api/recalcular-claves/route.js';
import { GET as listarDevoluciones } from '../app/api/devoluciones/route.js';
import { GET as listarImportaciones } from '../app/api/importaciones/route.js';
import { DELETE as borrarImportacion } from '../app/api/importaciones/[id]/route.js';
import { crearProyecto } from '../lib/proyectos.cjs';
import { query } from '../lib/db.cjs';

const NOMBRE_PROYECTO = 'Proyecto de prueba de rutas';

async function limpiarTodo() {
  await limpiar();
  await query(`DELETE FROM importaciones WHERE nombre_archivo LIKE 'PRUEBA-rutas%'`);
  await query(`DELETE FROM memoria_proveedores WHERE hoja = $1`, [HOJA]);
  await query(`DELETE FROM memoria_proveedor_nombre WHERE hoja = $1`, [HOJA]);
  await query(`DELETE FROM proyectos WHERE nombre = $1`, [NOMBRE_PROYECTO]);
}
beforeEach(limpiarTodo);
afterAll(limpiarTodo);

const post = (cuerpo = {}) => new Request('http://pruebas/', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo),
});
const conId = id => ({ params: Promise.resolve({ id: String(id) }) });
const estadoDe = async id => (await lineaPorId(id)).estado;

describe('confirmar una línea', () => {
  it('150. la línea queda resuelta con su nota, y la app aprende esa nota para el grupo', async () => {
    const linea = await sembrarLinea({ importe: -45 });

    const r = await confirmar(post({ nota: 'material de oficina' }), conId(linea.id));

    expect(r.status).toBe(200);
    const m = await lineaPorId(linea.id);
    expect(m.estado).toBe('resuelta');
    expect(m.nota_final).toBe('material de oficina');
    const { rows } = await query(`SELECT nota, veces FROM memoria_proveedores WHERE hoja = $1`, [HOJA]);
    expect(rows).toEqual([{ nota: 'material de oficina', veces: 1 }]);
  });

  it('151. una nota que es solo números de factura se guarda en la línea pero no se aprende', async () => {
    const linea = await sembrarLinea({ importe: -45 });

    await confirmar(post({ nota: '59 y 60' }), conId(linea.id));

    expect((await lineaPorId(linea.id)).nota_final).toBe('59 y 60');
    const { rows } = await query(`SELECT 1 FROM memoria_proveedores WHERE hoja = $1`, [HOJA]);
    expect(rows).toHaveLength(0);
  });
});

describe('cambiar el estado de una línea', () => {
  it('152. cada estado de la pantalla se traduce al de la base de datos', async () => {
    const linea = await sembrarLinea({ importe: -45 });
    const casos = [['pedida', 'pedida_pendiente'], ['factura_futura', 'factura_futura'], ['ignorar', 'ignorada'], ['pendiente', 'sin_resolver']];

    for (const [pantalla, base] of casos) {
      expect((await cambiarEstado(post({ estado: pantalla }), conId(linea.id))).status).toBe(200);
      expect(await estadoDe(linea.id)).toBe(base);
    }
  });

  it('153. un estado que no existe da error y no cambia nada', async () => {
    const linea = await sembrarLinea({ importe: -45, estado: 'ignorada' });

    const r = await cambiarEstado(post({ estado: 'resuelta' }), conId(linea.id));

    expect(r.status).toBe(400);
    expect(await estadoDe(linea.id)).toBe('ignorada');
  });
});

describe('el proveedor de una línea', () => {
  it('154. se guarda sin espacios sobrantes y la app lo aprende para el grupo', async () => {
    const linea = await sembrarLinea({ importe: -45 });

    await guardarProveedor(post({ proveedor: '  Ferretería López  ' }), conId(linea.id));

    expect((await lineaPorId(linea.id)).proveedor).toBe('Ferretería López');
    const { rows } = await query(`SELECT nombre FROM memoria_proveedor_nombre WHERE hoja = $1`, [HOJA]);
    expect(rows).toEqual([{ nombre: 'Ferretería López' }]);
  });

  it('155. dejarlo vacío lo quita y la app se olvida de él', async () => {
    const linea = await sembrarLinea({ importe: -45 });
    await guardarProveedor(post({ proveedor: 'Ferretería López' }), conId(linea.id));

    await guardarProveedor(post({ proveedor: '   ' }), conId(linea.id));

    expect((await lineaPorId(linea.id)).proveedor).toBeNull();
    const { rows } = await query(`SELECT 1 FROM memoria_proveedor_nombre WHERE hoja = $1`, [HOJA]);
    expect(rows).toHaveLength(0);
  });
});

describe('el proyecto de una línea', () => {
  it('156. se asigna, y se quita al mandar vacío', async () => {
    const linea = await sembrarLinea({ importe: -45 });
    const { id: proyectoId } = await crearProyecto(NOMBRE_PROYECTO);

    await asignarProyecto(post({ proyectoId }), conId(linea.id));
    expect(String((await lineaPorId(linea.id)).proyecto_id)).toBe(String(proyectoId));

    await asignarProyecto(post({ proyectoId: '' }), conId(linea.id));
    expect((await lineaPorId(linea.id)).proyecto_id).toBeNull();
  });
});

describe('una devolución', () => {
  it('157. queda resuelta, marcada como devolución y con el jugador; y se queda sin proveedor', async () => {
    const linea = await sembrarLinea({ importe: -30 });
    await guardarProveedor(post({ proveedor: 'Alguien' }), conId(linea.id));

    await marcarDevolucion(post({ jugador: ' Aine Sweeney ' }), conId(linea.id));

    const m = await lineaPorId(linea.id);
    expect(m).toMatchObject({ estado: 'resuelta', es_devolucion: true, jugador_larpmanager: 'Aine Sweeney', proveedor: null });
  });

  it('158. la lista de devoluciones respeta el rango de fechas', async () => {
    const dentro = await sembrarLinea({ importe: -30, fecha: '2026-09-10' });
    const fuera = await sembrarLinea({ importe: -40, fecha: '2026-07-10' });
    await marcarDevolucion(post({ jugador: 'Uno' }), conId(dentro.id));
    await marcarDevolucion(post({ jugador: 'Dos' }), conId(fuera.id));

    const r = await listarDevoluciones(new Request('http://pruebas/api/devoluciones?desde=2026-09-01&hasta=2026-09-30'));
    const { devoluciones } = await r.json();

    expect(devoluciones.map(d => String(d.id))).toEqual([String(dentro.id)]);
  });
});

describe('vincular y desvincular el pago de un colaborador', () => {
  it('159. vincular sin decir el pago da error, y un pago que no existe da 404', async () => {
    const linea = await sembrarLinea({ importe: -45 });

    expect((await vincularPago(post({}), conId(linea.id))).status).toBe(400);
    expect((await vincularPago(post({ pagoId: 987654321 }), conId(linea.id))).status).toBe(404);
    expect(await estadoDe(linea.id)).toBe('sin_resolver');
  });

  it('160. desvincular un pago que no existe da 404', async () => {
    expect((await desvincularPago(post(), conId(987654321))).status).toBe(404);
  });
});

describe('acciones sobre un grupo entero de líneas', () => {
  const grupo = { hoja: HOJA, clave: 'pruebas' };

  it('161. sin decir el grupo (hoja y clave) dan error y no tocan nada', async () => {
    const linea = await sembrarLinea({ importe: -45 });

    for (const ruta of [confirmarGrupo, pendienteGrupo, proveedorGrupo, proyectoGrupo]) {
      expect((await ruta(post({ nota: 'x' }))).status).toBe(400);
    }
    expect(await estadoDe(linea.id)).toBe('sin_resolver');
  });

  it('162. confirmar un grupo resuelve sus líneas pendientes con la nota y dice cuántas', async () => {
    const a = await sembrarLinea({ importe: -10 });
    const b = await sembrarLinea({ importe: -20 });

    const r = await confirmarGrupo(post({ ...grupo, nota: 'viajes' }));

    expect(await r.json()).toMatchObject({ ok: true, lineas: 2 });
    for (const l of [a, b]) expect(await lineaPorId(l.id)).toMatchObject({ estado: 'resuelta', nota_final: 'viajes' });
  });

  it('162b. confirmar un grupo solo toca las pendientes: las resueltas conservan su nota y las ignoradas y de factura futura no cambian', async () => {
    const sinResolver = await sembrarLinea({ importe: -10 });
    const pedida = await sembrarLinea({ importe: -20, estado: 'pedida_pendiente' });
    const resuelta = await sembrarLinea({ importe: -30, estado: 'resuelta' });
    const ignorada = await sembrarLinea({ importe: -40, estado: 'ignorar' });
    const futura = await sembrarLinea({ importe: -50, estado: 'factura_futura' });
    await query(`UPDATE movimientos SET nota_final = 'nota original' WHERE id = $1`, [resuelta.id]);

    const r = await confirmarGrupo(post({ ...grupo, nota: 'viajes' }));

    expect(await r.json()).toMatchObject({ ok: true, lineas: 2 });
    expect(await lineaPorId(sinResolver.id)).toMatchObject({ estado: 'resuelta', nota_final: 'viajes' });
    expect(await lineaPorId(pedida.id)).toMatchObject({ estado: 'resuelta', nota_final: 'viajes' });
    expect(await lineaPorId(resuelta.id)).toMatchObject({ estado: 'resuelta', nota_final: 'nota original' });
    expect(await lineaPorId(ignorada.id)).toMatchObject({ estado: 'ignorar', nota_final: null });
    expect(await lineaPorId(futura.id)).toMatchObject({ estado: 'factura_futura', nota_final: null });
  });

  it('162c. en un grupo ya entero resuelto, escribir o borrar la nota corrige sus líneas resueltas, y sigue sin tocar las ignoradas ni las de factura futura', async () => {
    const a = await sembrarLinea({ importe: -10, estado: 'resuelta' });
    const b = await sembrarLinea({ importe: -20, estado: 'resuelta' });
    const ignorada = await sembrarLinea({ importe: -40, estado: 'ignorar' });
    const futura = await sembrarLinea({ importe: -50, estado: 'factura_futura' });
    await query(`UPDATE movimientos SET nota_final = 'nota vieja' WHERE id = ANY($1::bigint[])`, [[a.id, b.id]]);

    const corregir = await confirmarGrupo(post({ ...grupo, nota: 'nota corregida' }));

    expect(await corregir.json()).toMatchObject({ ok: true, lineas: 2 });
    for (const l of [a, b]) expect(await lineaPorId(l.id)).toMatchObject({ estado: 'resuelta', nota_final: 'nota corregida' });

    await confirmarGrupo(post({ ...grupo, nota: '' }));

    for (const l of [a, b]) expect(await lineaPorId(l.id)).toMatchObject({ estado: 'resuelta', nota_final: null });
    expect(await lineaPorId(ignorada.id)).toMatchObject({ estado: 'ignorar', nota_final: null });
    expect(await lineaPorId(futura.id)).toMatchObject({ estado: 'factura_futura', nota_final: null });
  });

  it('163. marcar un grupo como pedido solo toca las líneas que seguían sin resolver', async () => {
    const pendiente = await sembrarLinea({ importe: -10 });
    const ya = await sembrarLinea({ importe: -20, estado: 'resuelta' });

    const r = await pendienteGrupo(post(grupo));

    expect(await r.json()).toMatchObject({ ok: true, lineas: 1 });
    expect(await estadoDe(pendiente.id)).toBe('pedida_pendiente');
    expect(await estadoDe(ya.id)).toBe('resuelta');
  });

  it('164. el proveedor y el proyecto de un grupo se aplican a todas sus líneas', async () => {
    const a = await sembrarLinea({ importe: -10 });
    const b = await sembrarLinea({ importe: -20 });
    const { id: proyectoId } = await crearProyecto(NOMBRE_PROYECTO);

    await proveedorGrupo(post({ ...grupo, proveedor: ' Bolt ' }));
    await proyectoGrupo(post({ ...grupo, proyectoId }));

    for (const l of [a, b]) {
      const m = await lineaPorId(l.id);
      expect(m.proveedor).toBe('Bolt');
      expect(String(m.proyecto_id)).toBe(String(proyectoId));
    }

    await proveedorGrupo(post({ ...grupo, proveedor: '' }));
    await proyectoGrupo(post({ ...grupo, proyectoId: null }));
    for (const l of [a, b]) expect(await lineaPorId(l.id)).toMatchObject({ proveedor: null, proyecto_id: null });
  });
});

describe('el resumen, las claves y las subidas', () => {
  it('165. el resumen cuenta las líneas de cada hoja por estado', async () => {
    await sembrarLinea({ importe: -1, estado: 'resuelta' });
    await sembrarLinea({ importe: -2, estado: 'resuelta' });
    await sembrarLinea({ importe: -3, estado: 'ignorada' });
    await sembrarLinea({ importe: -4, estado: 'sin_resolver' });

    const datos = await (await resumen()).json();
    const propia = datos.porHoja.find(h => h.hoja === HOJA);

    expect(propia).toMatchObject({ total: '4', resueltas: '2', ignoradas: '1', sin_resolver: '1' });
    expect(datos.total).toBeGreaterThanOrEqual(4);
  });

  it('166. recalcular las claves corrige la que está mal y deja en paz las que están bien', async () => {
    const mal = await sembrarLinea({ importe: -45, concepto: 'AMAZON PAYMENTS EUROPE' });
    const bien = await sembrarLinea({ importe: -10, concepto: 'AMAZON OTRA' });
    await query(`UPDATE movimientos SET clave = '- AMAZON' WHERE id = $1`, [bien.id]);

    const datos = await (await recalcularClaves()).json();

    expect(datos.cambiadas).toBeGreaterThanOrEqual(1);
    expect((await lineaPorId(mal.id)).clave).toBe('- AMAZON');
    expect((await lineaPorId(bien.id)).clave).toBe('- AMAZON');
  });

  it('167. la lista de subidas dice cuántas líneas trajo cada una y cuántas están resueltas', async () => {
    const { rows: [imp] } = await query(`INSERT INTO importaciones (hoja, ruta_blob, nombre_archivo) VALUES ($1, 'https://ejemplo/x', 'PRUEBA-rutas-1.xlsx') RETURNING id`, [HOJA]);
    for (const [i, estado] of ['resuelta', 'sin_resolver', 'sin_resolver'].entries()) {
      await query(`INSERT INTO movimientos (hoja, fila, importacion_id, fecha, concepto, importe, clave, estado) VALUES ($1, $2, $3, '2026-07-01', 'X', -1, 'x', $4)`, [HOJA, i + 1, imp.id, estado]);
    }

    const { importaciones } = await (await listarImportaciones()).json();
    const suya = importaciones.find(i => i.nombreArchivo === 'PRUEBA-rutas-1.xlsx');

    expect(suya).toMatchObject({ hoja: HOJA, total: 3, resueltas: 1 });
  });

  it('168. borrar una subida se lleva sus líneas y no toca las de otras subidas', async () => {
    const { rows: [uno] } = await query(`INSERT INTO importaciones (hoja, ruta_blob, nombre_archivo) VALUES ($1, 'https://ejemplo/1', 'PRUEBA-rutas-2.xlsx') RETURNING id`, [HOJA]);
    const { rows: [dos] } = await query(`INSERT INTO importaciones (hoja, ruta_blob, nombre_archivo) VALUES ($1, 'https://ejemplo/2', 'PRUEBA-rutas-3.xlsx') RETURNING id`, [HOJA]);
    for (const [imp, fila] of [[uno.id, 1], [uno.id, 2], [dos.id, 1]]) {
      await query(`INSERT INTO movimientos (hoja, fila, importacion_id, fecha, concepto, importe, clave, estado) VALUES ($1, $2, $3, '2026-07-01', 'X', -1, 'x', 'sin_resolver')`, [HOJA, fila, imp]);
    }

    const r = await borrarImportacion(new Request('http://pruebas/', { method: 'DELETE' }), conId(uno.id));

    expect(r.status).toBe(200);
    const { rows: quedan } = await query(`SELECT importacion_id FROM movimientos WHERE hoja = $1`, [HOJA]);
    expect(quedan.map(q => String(q.importacion_id))).toEqual([String(dos.id)]);
    const { rows: subidas } = await query(`SELECT id FROM importaciones WHERE nombre_archivo LIKE 'PRUEBA-rutas%'`);
    expect(subidas.map(s => String(s.id))).toEqual([String(dos.id)]);
  });
});
