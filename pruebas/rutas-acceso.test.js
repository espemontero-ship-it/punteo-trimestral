import { describe, it, expect, beforeEach, afterAll, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { POST as entrar } from '../app/api/login/route.js';
import { POST as salir } from '../app/api/logout/route.js';
import { POST as recuperar } from '../app/api/recuperar/route.js';
import { POST as restablecer } from '../app/api/restablecer/[token]/route.js';
import { GET as verInvitacion, POST as aceptarInvitacion } from '../app/api/invitaciones/[token]/route.js';
import { PATCH as cambiarColaborador } from '../app/api/colaboradores/[id]/route.js';
import { GET as proyectosDeColaboradora } from '../app/api/colaborador/proyectos/route.js';
import { GET as lotesDeColaboradora } from '../app/api/colaborador/lotes/route.js';
import { POST as invitarDesdeColaboradora } from '../app/api/colaborador/invitaciones/route.js';
import { crearTokenSesion, leerSesion, SESSION_COOKIE } from '../lib/auth.cjs';
import { crearInvitacion, crearRestablecimiento } from '../lib/tokens.cjs';
import { verificarColaborador } from '../lib/colaboradores.cjs';
import { buscarOCrearLote } from '../lib/lotes.cjs';
import { query } from '../lib/db.cjs';

const CORREO = 'prueba-acceso@ejemplo.test';
const CORREO_NUEVO = 'prueba-acceso-nueva@ejemplo.test';
const CLAVE = 'una-clave-larga-1';
const PROYECTO = 'Proyecto de prueba de acceso';

async function limpiar() {
  await query(`DELETE FROM tokens_acceso WHERE usuario IN ($1, $2) OR colaborador_id IN (SELECT id FROM colaboradores WHERE usuario IN ($1, $2))`, [CORREO, CORREO_NUEVO]);
  await query(`DELETE FROM lotes WHERE colaborador_id IN (SELECT id FROM colaboradores WHERE usuario IN ($1, $2))`, [CORREO, CORREO_NUEVO]);
  await query(`DELETE FROM colaboradores WHERE usuario IN ($1, $2)`, [CORREO, CORREO_NUEVO]);
  await query(`DELETE FROM proyectos WHERE nombre = $1`, [PROYECTO]);
}
beforeEach(async () => { process.env.AUTH_SECRET = 'secreto-de-pruebas'; await limpiar(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
afterAll(limpiar);

async function sembrarColaboradora(cambios = {}) {
  const hash = await bcrypt.hash(CLAVE, 4);
  const { rows: [c] } = await query(
    `INSERT INTO colaboradores (nombre, usuario, password_hash, rol, estado, puede_invitar) VALUES ('Persona de prueba acceso', $1, $2, $3, $4, $5) RETURNING id`,
    [CORREO, hash, cambios.rol || 'colaborador', cambios.estado || 'activo', !!cambios.puedeInvitar]
  );
  return c.id;
}

const json = (cuerpo = {}) => new Request('http://pruebas/', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo),
});
const conToken = token => ({ params: Promise.resolve({ token }) });
const conId = id => ({ params: Promise.resolve({ id: String(id) }) });
const cookieDe = r => (r.headers.get('set-cookie') || '');
const conSesion = async (ruta, sesion, cuerpo) => new NextRequest(`http://app.test${ruta}`, {
  method: cuerpo ? 'POST' : 'GET',
  headers: { cookie: `${SESSION_COOKIE}=${await crearTokenSesion(sesion)}`, 'Content-Type': 'application/json' },
  ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}),
});

describe('entrar en la aplicación', () => {
  it('190. con el correo y la contraseña buenos entra, y la cookie es privada del navegador', async () => {
    await sembrarColaboradora();

    const r = await entrar(json({ usuario: CORREO, password: CLAVE }));
    const cookie = cookieDe(r);

    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, redirect: '/colaborador' });
    expect(cookie).toContain(`${SESSION_COOKIE}=`);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).not.toContain('Secure');
    const sesion = await leerSesion(cookie.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))[1]);
    expect(sesion).toMatchObject({ rol: 'colaborador', nombre: 'Persona de prueba acceso' });
  });

  it('191. en producción la cookie lleva Secure, y la administradora va a la página principal', async () => {
    await sembrarColaboradora({ rol: 'admin' });
    vi.stubEnv('NODE_ENV', 'production');

    const r = await entrar(json({ usuario: CORREO, password: CLAVE }));

    expect(await r.json()).toMatchObject({ redirect: '/' });
    expect(cookieDe(r)).toContain('Secure');
  });

  it('192. una contraseña mala y un correo que no existe dan exactamente el mismo mensaje, para no revelar quién tiene cuenta', async () => {
    await sembrarColaboradora();

    const mala = await entrar(json({ usuario: CORREO, password: 'otra-clave' }));
    const inexistente = await entrar(json({ usuario: 'nadie@ejemplo.test', password: CLAVE }));

    expect(mala.status).toBe(401);
    expect(inexistente.status).toBe(401);
    expect(await mala.json()).toEqual(await inexistente.json());
    expect(cookieDe(mala)).toBe('');
  });

  it('193. sin correo no entra, y una cuenta inactiva no entra aunque la contraseña sea buena', async () => {
    await sembrarColaboradora({ estado: 'inactivo' });

    expect((await entrar(json({ password: CLAVE }))).status).toBe(401);
    const inactiva = await entrar(json({ usuario: CORREO, password: CLAVE }));
    expect(inactiva.status).toBe(403);
    expect(cookieDe(inactiva)).toBe('');
  });

  it('194. salir borra la cookie', async () => {
    const r = await salir();

    expect(cookieDe(r)).toContain(`${SESSION_COOKIE}=;`);
    expect(cookieDe(r)).toContain('Max-Age=0');
  });
});

describe('olvidé mi contraseña', () => {
  it('195. responde lo mismo si el correo existe o no, y solo crea el enlace si existe', async () => {
    await sembrarColaboradora();
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const existe = await (await recuperar(json({ usuario: CORREO }))).json();
    const noExiste = await (await recuperar(json({ usuario: 'nadie@ejemplo.test' }))).json();
    const vacio = await (await recuperar(json({}))).json();

    expect(existe).toEqual(noExiste);
    expect(vacio).toEqual(noExiste);
    const { rows } = await query(`SELECT 1 FROM tokens_acceso WHERE tipo = 'restablecimiento' AND colaborador_id IN (SELECT id FROM colaboradores WHERE usuario = $1)`, [CORREO]);
    expect(rows).toHaveLength(1);
  });

  it('196. una contraseña de menos de 8 caracteres se rechaza sin gastar el enlace', async () => {
    const id = await sembrarColaboradora();
    const token = await crearRestablecimiento(id);

    expect((await restablecer(json({ password: 'corta' }), conToken(token))).status).toBe(400);
    expect((await restablecer(json({}), conToken(token))).status).toBe(400);
    expect((await restablecer(json({ password: 'una-nueva-larga' }), conToken(token))).status).toBe(200);
  });

  it('197. con el enlace bueno se cambia la contraseña: la nueva entra, la vieja ya no, y el enlace no se puede usar dos veces', async () => {
    const id = await sembrarColaboradora();
    const token = await crearRestablecimiento(id);

    const r = await restablecer(json({ password: 'contraseña-nueva-1' }), conToken(token));

    expect(r.status).toBe(200);
    expect(await verificarColaborador(CORREO, 'contraseña-nueva-1')).not.toBeNull();
    expect(await verificarColaborador(CORREO, CLAVE)).toBeNull();
    expect((await restablecer(json({ password: 'otra-contraseña-2' }), conToken(token))).status).toBe(404);
    expect(await verificarColaborador(CORREO, 'otra-contraseña-2')).toBeNull();
  });

  it('198. un enlace inventado da 404', async () => {
    expect((await restablecer(json({ password: 'contraseña-nueva-1' }), conToken('f'.repeat(64)))).status).toBe(404);
  });
});

describe('aceptar una invitación', () => {
  it('199. el enlace dice a quién va dirigido, y uno inventado da 404', async () => {
    const token = await crearInvitacion({ nombre: 'Persona nueva', usuario: CORREO_NUEVO, puedeSubirFacturasGenerales: true });

    const bien = await verInvitacion(new Request('http://pruebas/'), conToken(token));
    expect(await bien.json()).toMatchObject({ nombre: 'Persona nueva', puedeSubirFacturasGenerales: true });
    expect((await verInvitacion(new Request('http://pruebas/'), conToken('a'.repeat(64)))).status).toBe(404);
  });

  it('200. al elegir contraseña se crea la cuenta, entra directamente y el enlace deja de valer', async () => {
    const token = await crearInvitacion({ nombre: 'Persona nueva', usuario: CORREO_NUEVO });

    const r = await aceptarInvitacion(json({ password: 'contraseña-larga-1' }), conToken(token));

    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, redirect: '/colaborador' });
    expect(cookieDe(r)).toContain(`${SESSION_COOKIE}=`);
    expect(await verificarColaborador(CORREO_NUEVO, 'contraseña-larga-1')).toMatchObject({ rol: 'colaborador', estado: 'activo' });
    expect((await aceptarInvitacion(json({ password: 'contraseña-larga-1' }), conToken(token))).status).toBe(404);
  });

  it('201. con una contraseña corta no se crea nada y el enlace sigue valiendo', async () => {
    const token = await crearInvitacion({ nombre: 'Persona nueva', usuario: CORREO_NUEVO });

    expect((await aceptarInvitacion(json({ password: '1234' }), conToken(token))).status).toBe(400);

    expect(await verificarColaborador(CORREO_NUEVO, '1234')).toBeNull();
    expect((await verInvitacion(new Request('http://pruebas/'), conToken(token))).status).toBe(200);
  });

  it('202. si ya existe una cuenta con ese correo, avisa con 409, no entra y el enlace NO se gasta', async () => {
    await sembrarColaboradora();
    const token = await crearInvitacion({ nombre: 'Persona de prueba acceso', usuario: CORREO });

    const r = await aceptarInvitacion(json({ password: 'contraseña-larga-1' }), conToken(token));

    expect(r.status).toBe(409);
    expect(cookieDe(r)).toBe('');
    expect((await verInvitacion(new Request('http://pruebas/'), conToken(token))).status).toBe(200);
    expect(await verificarColaborador(CORREO, 'contraseña-larga-1')).toBeNull();
  });
});

describe('administrar a las colaboradoras', () => {
  it('203. se puede activar, desactivar y dar permisos; un estado raro da error', async () => {
    const id = await sembrarColaboradora();
    const patch = cuerpo => cambiarColaborador(new Request('http://pruebas/', { method: 'PATCH', body: JSON.stringify(cuerpo) }), conId(id));

    expect((await patch({ estado: 'inactivo', puedeInvitar: true, puedeSubirFacturasGenerales: true })).status).toBe(200);
    const { rows: [c] } = await query(`SELECT estado, puede_invitar, puede_subir_facturas_generales FROM colaboradores WHERE id = $1`, [id]);
    expect(c).toEqual({ estado: 'inactivo', puede_invitar: true, puede_subir_facturas_generales: true });

    expect((await patch({ estado: 'borrada' })).status).toBe(400);
  });
});

describe('la zona de las colaboradoras', () => {
  it('204. sin sesión, o con la sesión de la administradora, las rutas de la colaboradora dan 403', async () => {
    const sinSesion = new NextRequest('http://app.test/api/colaborador/lotes');

    expect((await lotesDeColaboradora(sinSesion)).status).toBe(403);
    expect((await proyectosDeColaboradora(sinSesion)).status).toBe(403);
    expect((await lotesDeColaboradora(await conSesion('/api/colaborador/lotes', { rol: 'admin' }))).status).toBe(403);
    expect((await invitarDesdeColaboradora(await conSesion('/api/colaborador/invitaciones', { rol: 'admin' }, {}))).status).toBe(403);
  });

  it('205. una colaboradora ve sus lotes y qué permisos tiene', async () => {
    const id = await sembrarColaboradora({ puedeInvitar: true });

    const r = await lotesDeColaboradora(await conSesion('/api/colaborador/lotes', { rol: 'colaborador', colaboradorId: id, nombre: 'Persona de prueba acceso' }));

    expect(await r.json()).toMatchObject({ nombre: 'Persona de prueba acceso', puedeInvitar: true, puedeSubirFacturasGenerales: false, lotes: [] });
  });

  it('206. sin el permiso de invitar no puede invitar; con él, solo a su propio proyecto y con todos los datos', async () => {
    const sin = await sembrarColaboradora();
    const invitar = (id, cuerpo) => conSesion('/api/colaborador/invitaciones', { rol: 'colaborador', colaboradorId: id, nombre: 'X' }, cuerpo);

    expect((await invitarDesdeColaboradora(await invitar(sin, { nombre: 'A', usuario: CORREO_NUEVO, proyectoId: 1 }))).status).toBe(403);

    await query(`UPDATE colaboradores SET puede_invitar = true WHERE id = $1`, [sin]);
    expect((await invitarDesdeColaboradora(await invitar(sin, { nombre: 'A' }))).status).toBe(400);

    const { rows: [p] } = await query(`INSERT INTO proyectos (nombre) VALUES ($1) RETURNING id`, [PROYECTO]);
    const ajeno = await invitarDesdeColaboradora(await invitar(sin, { nombre: 'A', usuario: CORREO_NUEVO, proyectoId: p.id }));
    expect(ajeno.status).toBe(403);
    expect((await ajeno.json()).error).toContain('tu propio proyecto');

    await buscarOCrearLote(sin, p.id);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const propio = await invitarDesdeColaboradora(await invitar(sin, { nombre: 'A', usuario: CORREO_NUEVO, proyectoId: p.id }));
    expect(propio.status).toBe(200);
    expect((await propio.json()).enlace).toMatch(/\/invitacion\/[0-9a-f]{64}$/);
  });
});
