import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { limpiar, subir, sembrarLinea, lector, facturaPorNombre, lineaPorId, HOJA } from './ayuda.js';
import { POST as guardarImporte } from '../app/api/facturas/[id]/importe/route.js';
import { POST as guardarDatos } from '../app/api/facturas/[id]/datos/route.js';
import { GET as buscarHuella } from '../app/api/facturas/huella/route.js';
import { GET as listarProyectos, POST as crearProyecto } from '../app/api/proyectos/route.js';
import { POST as cerrarProyecto } from '../app/api/proyectos/[id]/cerrar/route.js';
import { GET as devolucionesDeProyecto } from '../app/api/proyectos/[id]/devoluciones/route.js';
import { GET as futurasDeProyecto } from '../app/api/proyectos/[id]/facturas-futuras/route.js';
import { GET as verLote } from '../app/api/lotes/[id]/route.js';
import { POST as altaLote } from '../app/api/lotes/route.js';
import { crearTokenSesion, SESSION_COOKIE } from '../lib/auth.cjs';
import { query } from '../lib/db.cjs';

const PROYECTO = 'Proyecto de prueba de facturas';

async function limpiarTodo() {
  await limpiar();
  await query(`DELETE FROM sugerencias_rechazadas WHERE hoja = $1`, [HOJA]);
  await query(`DELETE FROM proyectos WHERE nombre = $1`, [PROYECTO]);
}
beforeEach(async () => { process.env.AUTH_SECRET = 'secreto-de-pruebas'; await limpiarTodo(); });
afterAll(limpiarTodo);

const post = (cuerpo = {}) => new Request('http://pruebas/', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo),
});
const conId = id => ({ params: Promise.resolve({ id: String(id) }) });
const unaDe = importe => lector([{ importe, fecha: '2026-07-19', proveedor: 'Proveedor' }]);

describe('corregir a mano el importe de una factura', () => {
  it('170. un importe vacío, cero o que no es un número da error y no toca la factura', async () => {
    const { archivo } = await subir({ leer: unaDe(45) });
    const f = await facturaPorNombre(archivo);

    for (const importe of [undefined, null, '', 0, 'abc']) {
      expect((await guardarImporte(post({ importe }), conId(f.id))).status).toBe(400);
    }
    expect(Number((await facturaPorNombre(archivo)).totales[0])).toBe(45);
  });

  it('171. un importe bueno se guarda y la factura vuelve a buscar su línea', async () => {
    const linea = await sembrarLinea({ importe: -52.5 });
    const { archivo } = await subir({ leer: unaDe(45) });
    const f = await facturaPorNombre(archivo);

    const r = await guardarImporte(post({ importe: 52.5 }), conId(f.id));

    expect(r.status).toBe(200);
    const despues = await facturaPorNombre(archivo);
    expect(Number(despues.totales[0])).toBe(52.5);
    expect(despues.motivo_tipo).toBe('ambiguo');
    expect(String(despues.motivo_candidatos.candidatos[0].movimientoId)).toBe(String(linea.id));
    expect((await lineaPorId(linea.id)).estado).toBe('sin_resolver');
  });
});

describe('corregir a mano los datos de una factura', () => {
  it('172. un importe que no vale da error', async () => {
    const { archivo } = await subir({ leer: unaDe(45) });
    const f = await facturaPorNombre(archivo);

    expect((await guardarDatos(post({ importe: 'abc' }), conId(f.id))).status).toBe(400);
    expect((await guardarDatos(post({ importe: '0' }), conId(f.id))).status).toBe(400);
  });

  it('173. "solo guardar" apunta la fecha y el concepto sin volver a buscar línea', async () => {
    const { archivo } = await subir({ leer: unaDe(45) });
    const f = await facturaPorNombre(archivo);

    const r = await guardarDatos(post({ fecha: '2026-08-01', concepto: 'gasolina', soloGuardar: true }), conId(f.id));

    expect(await r.json()).toEqual({ tipo: 'guardado' });
    const despues = await facturaPorNombre(archivo);
    expect(despues.concepto).toBe('gasolina');
    expect(despues.fecha_texto).toBe('2026-08-01');
  });

  it('174. sin "solo guardar", cambiar los datos recalcula qué línea le corresponde', async () => {
    const linea = await sembrarLinea({ importe: -60 });
    const { archivo } = await subir({ leer: unaDe(45) });
    const f = await facturaPorNombre(archivo);

    await guardarDatos(post({ importe: 60 }), conId(f.id));

    const despues = await facturaPorNombre(archivo);
    expect(String(despues.motivo_candidatos.candidatos[0].movimientoId)).toBe(String(linea.id));
  });
});

describe('saber si un archivo ya está subido', () => {
  const pregunta = async (huella, rol) => {
    const headers = {};
    if (rol) headers.cookie = `${SESSION_COOKIE}=${await crearTokenSesion({ rol })}`;
    return buscarHuella(new NextRequest(`http://app.test/api/facturas/huella${huella ? `?h=${huella}` : ''}`, { headers }));
  };

  it('175. sin huella, o con una que no existe, dice que no está', async () => {
    expect(await (await pregunta(null)).json()).toEqual({ existe: false });
    expect(await (await pregunta('0'.repeat(64))).json()).toEqual({ existe: false });
  });

  it('176. la administradora ve qué factura es; una colaboradora solo ve que ya existe', async () => {
    const { archivo } = await subir({ leer: unaDe(45) });
    const f = await facturaPorNombre(archivo);

    const admin = await (await pregunta(f.huella, 'admin')).json();
    const colaboradora = await (await pregunta(f.huella, 'colaborador')).json();

    expect(admin).toEqual({ existe: true, numero: f.numero, nombre: archivo });
    expect(colaboradora).toEqual({ existe: true });
  });
});

describe('los proyectos', () => {
  it('177. no se crea uno sin nombre; con nombre se crea, y repetir el nombre no lo duplica', async () => {
    expect((await crearProyecto(post({}))).status).toBe(400);

    const uno = await (await crearProyecto(post({ nombre: PROYECTO }))).json();
    const otro = await (await crearProyecto(post({ nombre: PROYECTO }))).json();

    expect(uno.ok).toBe(true);
    expect(String(otro.proyecto.id)).toBe(String(uno.proyecto.id));
    const { proyectos } = await (await listarProyectos()).json();
    expect(proyectos.filter(p => p.nombre === PROYECTO)).toHaveLength(1);
  });

  it('178. cerrar un proyecto lo marca como cerrado', async () => {
    const { proyecto } = await (await crearProyecto(post({ nombre: PROYECTO }))).json();

    await cerrarProyecto(post(), conId(proyecto.id));

    const { proyectos } = await (await listarProyectos()).json();
    expect(proyectos.find(p => p.nombre === PROYECTO).estado).toBe('cerrado');
  });

  it('179. las devoluciones y las facturas futuras de un proyecto salen solo las suyas', async () => {
    const { proyecto } = await (await crearProyecto(post({ nombre: PROYECTO }))).json();
    const devolucion = await sembrarLinea({ importe: -30, fecha: '2026-09-10' });
    const futura = await sembrarLinea({ importe: -40, fecha: '2026-09-11', estado: 'factura_futura' });
    const ajena = await sembrarLinea({ importe: -50, fecha: '2026-09-12', estado: 'factura_futura' });
    await query(`UPDATE movimientos SET es_devolucion = true, proyecto_id = $2 WHERE id = $1`, [devolucion.id, proyecto.id]);
    await query(`UPDATE movimientos SET proyecto_id = $2 WHERE id = $1`, [futura.id, proyecto.id]);

    const { devoluciones } = await (await devolucionesDeProyecto(new Request('http://pruebas/'), conId(proyecto.id))).json();
    const { facturas } = await (await futurasDeProyecto(new Request('http://pruebas/'), conId(proyecto.id))).json();

    expect(devoluciones.map(d => String(d.id))).toEqual([String(devolucion.id)]);
    expect(facturas.map(f => String(f.id))).toEqual([String(futura.id)]);
    expect(facturas.map(f => String(f.id))).not.toContain(String(ajena.id));
  });
});

describe('los lotes de las colaboradoras', () => {
  it('180. un lote que no existe da 404', async () => {
    expect((await verLote(new Request('http://pruebas/'), conId(987654321))).status).toBe(404);
  });

  it('181. dar de alta sin nombre o sin correo da error', async () => {
    const alta = cuerpo => altaLote(new NextRequest('http://app.test/api/lotes', { method: 'POST', body: JSON.stringify(cuerpo) }));

    expect((await alta({ nombre: 'Solo nombre' })).status).toBe(400);
    expect((await alta({ usuario: 'solo@correo.test' })).status).toBe(400);
  });
});
