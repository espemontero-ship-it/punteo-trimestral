import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { lector } from './ayuda.js';
import { crearTokenSesion, SESSION_COOKIE } from '../lib/auth.cjs';
import { analizarFactura } from '../lib/facturaMatcher.cjs';
import { buscarOCrearLote, subirFacturaLote, listarFacturasDeLote } from '../lib/lotes.cjs';
import { cerrarProyecto } from '../lib/proyectos.cjs';
import { POST as subirGeneral } from '../app/api/colaborador/facturas-generales/route.js';
import { GET as verLoteColaboradora } from '../app/api/colaborador/lotes/[id]/route.js';
import { PATCH as corregirFactura, DELETE as retirarFactura } from '../app/api/colaborador/facturas/[id]/route.js';
import { PATCH as revisarFactura, DELETE as borrarFactura } from '../app/api/lotes/[id]/facturas/[facturaId]/route.js';
import { GET as verLoteAdmin } from '../app/api/lotes/[id]/route.js';
import { GET as pendientesDeProyecto } from '../app/api/proyectos/[id]/facturas-lote/route.js';
import { query } from '../lib/db.cjs';

const CORREO_A = 'prueba-colab-a@ejemplo.test';
const CORREO_B = 'prueba-colab-b@ejemplo.test';
const PROYECTO = 'Proyecto de prueba de colaboradoras';

async function limpiar() {
  const quienes = `(SELECT id FROM colaboradores WHERE usuario IN ($1, $2))`;
  await query(`DELETE FROM pagos WHERE lote_id IN (SELECT id FROM lotes WHERE colaborador_id IN ${quienes})`, [CORREO_A, CORREO_B]);
  await query(`DELETE FROM facturas WHERE nombre_original LIKE 'PRUEBA-colab%'`);
  await query(`DELETE FROM lotes WHERE colaborador_id IN ${quienes}`, [CORREO_A, CORREO_B]);
  await query(`DELETE FROM colaboradores WHERE usuario IN ($1, $2)`, [CORREO_A, CORREO_B]);
  await query(`DELETE FROM proyectos WHERE nombre = $1`, [PROYECTO]);
}
beforeEach(async () => { process.env.AUTH_SECRET = 'secreto-de-pruebas'; await limpiar(); });
afterAll(limpiar);

let contador = 0;
async function montar() {
  const hash = await bcrypt.hash('x', 4);
  const crear = async (usuario, nombre, extra = false) => (await query(
    `INSERT INTO colaboradores (nombre, usuario, password_hash, puede_subir_facturas_generales) VALUES ($1, $2, $3, $4) RETURNING id`, [nombre, usuario, hash, extra]
  )).rows[0].id;
  const a = await crear(CORREO_A, 'Colaboradora A');
  const b = await crear(CORREO_B, 'Colaboradora B');
  const { rows: [p] } = await query(`INSERT INTO proyectos (nombre) VALUES ($1) RETURNING id`, [PROYECTO]);
  const loteA = await buscarOCrearLote(a, p.id);
  const loteB = await buscarOCrearLote(b, p.id);
  return { a, b, proyectoId: p.id, loteA, loteB };
}

async function facturaEn(loteId, importe = 45) {
  contador++;
  const nombre = `PRUEBA-colab-${contador}.pdf`;
  const analisis = await analizarFactura(Buffer.from(`${nombre}-${Math.random()}`), true, nombre, lector([{ importe, fecha: '2026-07-19', proveedor: 'Proveedor' }]));
  const { id } = await subirFacturaLote({ loteId, rutaBlob: `https://ejemplo/${nombre}`, nombreOriginal: nombre, concepto: 'material', analisis });
  return id;
}

const conSesion = async (ruta, sesion, { metodo = 'GET', cuerpo } = {}) => new NextRequest(`http://app.test${ruta}`, {
  method: metodo,
  headers: { cookie: sesion ? `${SESSION_COOKIE}=${await crearTokenSesion(sesion)}` : '', 'Content-Type': 'application/json' },
  ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}),
});
const comoColab = id => ({ rol: 'colaborador', colaboradorId: String(id), nombre: 'X' });
const conId = (id, extra = {}) => ({ params: Promise.resolve({ id: String(id), ...extra }) });
const estadoRevision = async id => (await query(`SELECT estado_revision FROM facturas WHERE id = $1`, [id])).rows[0]?.estado_revision;

describe('subir una factura general como colaboradora', () => {
  it('240. sin sesión, o con la de la administradora, da 403; y faltan datos da 400 antes de tocar nada', async () => {
    const { a } = await montar();
    const cuerpo = { rutaBlob: 'https://ejemplo/x.pdf', nombreOriginal: 'x.pdf', proyectoId: 1, quienPaga: 'colaborador' };
    const subir = (sesion, c) => conSesion('/api/colaborador/facturas-generales', sesion, { metodo: 'POST', cuerpo: c }).then(subirGeneral);

    expect((await subir(null, cuerpo)).status).toBe(403);
    expect((await subir({ rol: 'admin' }, cuerpo)).status).toBe(403);
    expect((await subir(comoColab(a), { ...cuerpo, rutaBlob: undefined })).status).toBe(400);
    expect((await subir(comoColab(a), { ...cuerpo, proyectoId: undefined })).status).toBe(400);
    expect((await subir(comoColab(a), { ...cuerpo, quienPaga: 'otro' })).status).toBe(400);
  });

  it('241. subir una factura que paga la asociación exige el permiso especial', async () => {
    const { a } = await montar();

    const r = await subirGeneral(await conSesion('/api/colaborador/facturas-generales', comoColab(a), {
      metodo: 'POST', cuerpo: { rutaBlob: 'https://ejemplo/x.pdf', nombreOriginal: 'x.pdf', proyectoId: 1, quienPaga: 'nol' },
    }));

    expect(r.status).toBe(403);
    expect((await r.json()).error).toContain('permiso');
  });
});

describe('ver un lote: cada colaboradora solo ve el suyo', () => {
  it('242. el suyo sí, el de otra colaboradora y uno que no existe dan 404, y la administradora no entra por aquí', async () => {
    const { a, loteA, loteB } = await montar();
    await facturaEn(loteA, 45);
    const ver = async (id, sesion) => verLoteColaboradora(await conSesion(`/api/colaborador/lotes/${id}`, sesion), conId(id));

    const suyo = await ver(loteA, comoColab(a));
    expect(suyo.status).toBe(200);
    expect((await suyo.json()).totales.totalAceptado).toBe(45);
    expect((await ver(loteB, comoColab(a))).status).toBe(404);
    expect((await ver(987654321, comoColab(a))).status).toBe(404);
    expect((await ver(loteA, { rol: 'admin' })).status).toBe(403);
    expect((await ver(loteA, null)).status).toBe(403);
  });
});

describe('corregir o retirar una factura propia', () => {
  const llamar = async (metodo, facturaId, sesion, cuerpo) => {
    const ruta = `/api/colaborador/facturas/${facturaId}`;
    const peticion = await conSesion(ruta, sesion, { metodo, cuerpo });
    return (metodo === 'PATCH' ? corregirFactura : retirarFactura)(peticion, conId(facturaId));
  };

  it('243. la dueña corrige el concepto y el importe, y el importe queda marcado como puesto a mano', async () => {
    const { a, loteA } = await montar();
    const id = await facturaEn(loteA, 45);

    const r = await llamar('PATCH', id, comoColab(a), { concepto: 'gasolina', importe: '52,5'.replace(',', '.') });

    expect(r.status).toBe(200);
    const { rows: [f] } = await query(`SELECT concepto, totales, importe_a_mano FROM facturas WHERE id = $1`, [id]);
    expect(f.concepto).toBe('gasolina');
    expect(Number(f.totales[0])).toBe(52.5);
    expect(f.importe_a_mano).toBe(true);
  });

  it('244. un importe vacío no se toca, y uno que no vale (cero o texto) da error', async () => {
    const { a, loteA } = await montar();
    const id = await facturaEn(loteA, 45);

    expect((await llamar('PATCH', id, comoColab(a), { concepto: 'solo concepto', importe: '' })).status).toBe(200);
    expect(Number((await query(`SELECT totales FROM facturas WHERE id = $1`, [id])).rows[0].totales[0])).toBe(45);
    expect((await llamar('PATCH', id, comoColab(a), { importe: 0 })).status).toBe(400);
    expect((await llamar('PATCH', id, comoColab(a), { importe: 'abc' })).status).toBe(400);
  });

  it('245. una colaboradora no puede corregir ni retirar la factura de otra: 403 y no cambia nada', async () => {
    const { a, loteB } = await montar();
    const ajena = await facturaEn(loteB, 45);

    const corregir = await llamar('PATCH', ajena, comoColab(a), { concepto: 'robada' });
    const retirar = await llamar('DELETE', ajena, comoColab(a));

    expect(corregir.status).toBe(403);
    expect(retirar.status).toBe(403);
    expect((await query(`SELECT concepto FROM facturas WHERE id = $1`, [ajena])).rows[0].concepto).toBe('material');
  });

  it('246. sin sesión, o con la sesión de la administradora, da 403; una factura que no existe da 404', async () => {
    const { a, loteA } = await montar();
    const id = await facturaEn(loteA, 45);

    expect((await llamar('PATCH', id, null, { concepto: 'x' })).status).toBe(403);
    expect((await llamar('DELETE', id, { rol: 'admin' })).status).toBe(403);
    expect((await llamar('DELETE', 987654321, comoColab(a))).status).toBe(404);
  });

  it('247. retirar una factura propia la borra; una ya revisada por la administración, o de un proyecto cerrado, no se toca', async () => {
    const { a, loteA, proyectoId } = await montar();
    const propia = await facturaEn(loteA, 45);
    const revisada = await facturaEn(loteA, 10);
    const revisadaOtra = await facturaEn(loteA, 20);
    await query(`UPDATE facturas SET estado_revision = 'rechazada' WHERE id = $1`, [revisada]);

    expect((await llamar('DELETE', propia, comoColab(a))).status).toBe(200);
    expect(await estadoRevision(propia)).toBeUndefined();
    const yaRevisada = await llamar('PATCH', revisada, comoColab(a), { concepto: 'x' });
    expect(yaRevisada.status).toBe(409);
    expect((await yaRevisada.json()).error).toContain('administración');

    await cerrarProyecto(proyectoId);
    expect((await llamar('DELETE', revisadaOtra, comoColab(a))).status).toBe(409);
  });
});

describe('la revisión de la administradora', () => {
  const revisar = async (metodo, loteId, facturaId, cuerpo) => {
    const peticion = new Request('http://pruebas/', { method: metodo, headers: { 'Content-Type': 'application/json' }, ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}) });
    return (metodo === 'PATCH' ? revisarFactura : borrarFactura)(peticion, conId(loteId, { facturaId: String(facturaId) }));
  };

  it('248. puede rechazar con motivo y volver a aceptar; el total aceptado y el rechazado se recalculan', async () => {
    const { loteA } = await montar();
    const uno = await facturaEn(loteA, 45);
    const dos = await facturaEn(loteA, 10);
    const totales = async () => (await (await verLoteAdmin(new Request('http://pruebas/'), conId(loteA))).json()).totales;

    expect(await totales()).toMatchObject({ totalAceptado: 55, totalRechazado: 0 });
    await revisar('PATCH', loteA, dos, { estadoRevision: 'rechazada', motivoRechazo: 'ilegible' });
    expect(await totales()).toMatchObject({ totalAceptado: 45, totalRechazado: 10 });
    await revisar('PATCH', loteA, dos, { estadoRevision: 'aceptada', motivoRechazo: null });
    expect(await totales()).toMatchObject({ totalAceptado: 55, totalRechazado: 0 });
    expect(await estadoRevision(uno)).toBe('aceptada');
  });

  it('249. una factura ya pagada no se edita ni se borra (409), y una que no existe da 404', async () => {
    const { loteA } = await montar();
    const id = await facturaEn(loteA, 45);
    await query(`UPDATE facturas SET estado_revision = 'pagada' WHERE id = $1`, [id]);

    expect((await revisar('PATCH', loteA, id, { concepto: 'x' })).status).toBe(409);
    expect((await revisar('DELETE', loteA, id)).status).toBe(409);
    expect((await revisar('PATCH', loteA, 987654321, { concepto: 'x' })).status).toBe(404);
    expect((await revisar('DELETE', loteA, 987654321)).status).toBe(404);
  });

  it('250. borrar una factura la oculta del lote sin perderla, y deja de contar', async () => {
    const { loteA } = await montar();
    const id = await facturaEn(loteA, 45);

    expect((await revisar('DELETE', loteA, id)).status).toBe(200);

    expect(await estadoRevision(id)).toBe('borrada');
    expect(await listarFacturasDeLote(loteA)).toHaveLength(0);
  });

  it('251. las facturas pendientes de un proyecto son solo las aceptadas', async () => {
    const { loteA, loteB, proyectoId } = await montar();
    const aceptada = await facturaEn(loteA, 45);
    const rechazada = await facturaEn(loteB, 10);
    await query(`UPDATE facturas SET estado_revision = 'rechazada' WHERE id = $1`, [rechazada]);

    const { facturas } = await (await pendientesDeProyecto(new Request('http://pruebas/'), conId(proyectoId))).json();

    expect(facturas.map(f => String(f.id))).toEqual([String(aceptada)]);
  });
});
