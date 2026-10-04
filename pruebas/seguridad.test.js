import { describe, it, expect, beforeEach, afterAll, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { crearTokenSesion, leerSesion, obtenerSesion, SESSION_COOKIE } from '../lib/auth.cjs';
import { crearInvitacion, crearRestablecimiento, verTokenPendiente, consumirToken } from '../lib/tokens.cjs';
import { verificarColaborador, actualizarEstadoColaborador, altaColaborador, obtenerColaborador } from '../lib/colaboradores.cjs';
import { proxy } from '../proxy.js';
import { query } from '../lib/db.cjs';

const USUARIO = 'prueba-seguridad@ejemplo.test';

async function limpiar() {
  await query(`DELETE FROM tokens_acceso WHERE usuario = $1 OR nombre = $2 OR colaborador_id IN (SELECT id FROM colaboradores WHERE usuario = $1)`, [USUARIO, 'Persona de prueba seguridad']);
  await query(`DELETE FROM colaboradores WHERE usuario = $1`, [USUARIO]);
}
beforeEach(async () => { process.env.AUTH_SECRET = 'secreto-de-pruebas'; await limpiar(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
afterAll(limpiar);

describe('la sesión firmada', () => {
  it('120. una sesión recién creada se lee con sus datos', async () => {
    const token = await crearTokenSesion({ rol: 'admin', nombre: 'Esperanza' });

    expect(await leerSesion(token)).toMatchObject({ rol: 'admin', nombre: 'Esperanza' });
  });

  it('121. si se toca el contenido (por ejemplo para hacerse administrador), la firma deja de valer', async () => {
    const token = await crearTokenSesion({ rol: 'colaborador', nombre: 'Ana' });
    const firma = token.slice(token.lastIndexOf('.') + 1);
    const falsificado = JSON.stringify({ rol: 'admin', nombre: 'Ana', exp: Date.now() + 1e9 }) + '.' + firma;

    expect(await leerSesion(falsificado)).toBeNull();
  });

  it('122. si se toca la firma, tampoco vale', async () => {
    const token = await crearTokenSesion({ rol: 'admin' });

    expect(await leerSesion(token.slice(0, -4) + '0000')).toBeNull();
  });

  it('123. una sesión firmada con otro secreto no vale', async () => {
    const token = await crearTokenSesion({ rol: 'admin' });
    process.env.AUTH_SECRET = 'otro-secreto-distinto';

    expect(await leerSesion(token)).toBeNull();
  });

  it('124. una sesión caduca a los 30 días', async () => {
    const ahora = Date.now();
    const token = await crearTokenSesion({ rol: 'admin' });

    vi.spyOn(Date, 'now').mockReturnValue(ahora + 29 * 24 * 3600 * 1000);
    expect(await leerSesion(token)).not.toBeNull();

    vi.spyOn(Date, 'now').mockReturnValue(ahora + 31 * 24 * 3600 * 1000);
    expect(await leerSesion(token)).toBeNull();
  });

  it('125. sin sesión, o con basura, no entra nadie', async () => {
    expect(await leerSesion(undefined)).toBeNull();
    expect(await leerSesion('')).toBeNull();
    expect(await leerSesion('sin-punto')).toBeNull();
    expect(await leerSesion('esto.no-es-hex')).toBeNull();
  });

  it('126. sin el secreto configurado la app se niega a firmar, en vez de firmar con uno vacío', async () => {
    delete process.env.AUTH_SECRET;

    await expect(crearTokenSesion({ rol: 'admin' })).rejects.toThrow(/AUTH_SECRET/);
  });

  it('127. la sesión se saca de la cookie de la petición', async () => {
    const token = await crearTokenSesion({ rol: 'admin', nombre: 'Esperanza' });
    const peticion = { cookies: { get: nombre => (nombre === SESSION_COOKIE ? { value: token } : undefined) } };

    expect(await obtenerSesion(peticion)).toMatchObject({ nombre: 'Esperanza' });
    expect(await obtenerSesion({ cookies: { get: () => undefined } })).toBeNull();
  });
});

describe('quién puede entrar a qué (en producción)', () => {
  const peticion = async (ruta, rol) => {
    const headers = {};
    if (rol) headers.cookie = `${SESSION_COOKIE}=${await crearTokenSesion({ rol, nombre: 'X' })}`;
    return new NextRequest(`http://app.test${ruta}`, { headers });
  };
  const pasa = r => r.headers.get('x-middleware-next') === '1';

  beforeEach(() => { vi.stubEnv('NODE_ENV', 'production'); });

  it('128. las páginas de entrada (login, recuperar contraseña, invitación) están abiertas sin sesión', async () => {
    for (const ruta of ['/login', '/api/login', '/recuperar', '/api/recuperar', '/restablecer/abc', '/invitacion/abc', '/api/invitaciones/abc']) {
      expect(pasa(await proxy(await peticion(ruta)))).toBe(true);
    }
  });

  it('129. sin sesión, una ruta de datos da 401 y una página lleva al login', async () => {
    const api = await proxy(await peticion('/api/facturas'));
    expect(api.status).toBe(401);

    const pagina = await proxy(await peticion('/'));
    expect(pagina.status).toBe(307);
    expect(pagina.headers.get('location')).toContain('/login');
  });

  it('130. la administradora entra en todo', async () => {
    for (const ruta of ['/', '/api/facturas', '/api/envios', '/api/colaboradores/1']) {
      expect(pasa(await proxy(await peticion(ruta, 'admin')))).toBe(true);
    }
  });

  it('131. un colaborador solo entra en su zona y en las rutas compartidas', async () => {
    for (const ruta of ['/colaborador', '/api/colaborador/lotes', '/api/blob-upload', '/api/facturas/huella']) {
      expect(pasa(await proxy(await peticion(ruta, 'colaborador')))).toBe(true);
    }
  });

  it('132. un colaborador no puede tocar los datos de la asociación: 403 en la API, y su zona en las páginas', async () => {
    for (const ruta of ['/api/facturas', '/api/envios', '/api/envios/3/deshacer', '/api/movimientos', '/api/colaboradores/1']) {
      const r = await proxy(await peticion(ruta, 'colaborador'));
      expect(r.status).toBe(403);
    }
    const pagina = await proxy(await peticion('/proyectos', 'colaborador'));
    expect(pagina.headers.get('location')).toContain('/colaborador');
  });

  it('133. una sesión falsificada se trata como si no hubiera sesión', async () => {
    const r = await proxy(new NextRequest('http://app.test/api/facturas', { headers: { cookie: `${SESSION_COOKIE}=${JSON.stringify({ rol: 'admin', exp: Date.now() + 1e9 })}.abcd` } }));

    expect(r.status).toBe(401);
  });
});

describe('las invitaciones y los enlaces de restablecer contraseña', () => {
  it('134. un enlace de invitación sirve una sola vez', async () => {
    const token = await crearInvitacion({ nombre: 'Persona de prueba seguridad', usuario: USUARIO });

    expect(await verTokenPendiente(token, 'invitacion')).toMatchObject({ nombre: 'Persona de prueba seguridad', usuario: USUARIO });
    expect(await consumirToken(token, 'invitacion')).toMatchObject({ usuario: USUARIO });
    expect(await consumirToken(token, 'invitacion')).toBeNull();
    expect(await verTokenPendiente(token, 'invitacion')).toBeNull();
  });

  it('135. en la base de datos no queda el enlace, solo su huella', async () => {
    const token = await crearInvitacion({ nombre: 'Persona de prueba seguridad', usuario: USUARIO });

    const { rows } = await query(`SELECT token_hash FROM tokens_acceso WHERE usuario = $1`, [USUARIO]);
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash).not.toBe(token);
    expect(rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('136. un enlace caducado no vale', async () => {
    const token = await crearInvitacion({ nombre: 'Persona de prueba seguridad', usuario: USUARIO });
    await query(`UPDATE tokens_acceso SET expira_en = now() - interval '1 minute' WHERE usuario = $1`, [USUARIO]);

    expect(await verTokenPendiente(token, 'invitacion')).toBeNull();
    expect(await consumirToken(token, 'invitacion')).toBeNull();
  });

  it('137. un enlace de invitación no sirve para restablecer una contraseña, ni al revés', async () => {
    const hash = await bcrypt.hash('clave-inicial', 4);
    const { rows: [c] } = await query(`INSERT INTO colaboradores (nombre, usuario, password_hash) VALUES ('Persona de prueba seguridad', $1, $2) RETURNING id`, [USUARIO, hash]);
    const invitacion = await crearInvitacion({ nombre: 'Persona de prueba seguridad', usuario: USUARIO });
    const restablecer = await crearRestablecimiento(c.id);

    expect(await verTokenPendiente(invitacion, 'restablecimiento')).toBeNull();
    expect(await verTokenPendiente(restablecer, 'invitacion')).toBeNull();
    expect(await verTokenPendiente(restablecer, 'restablecimiento')).toMatchObject({ colaborador_id: c.id });
  });

  it('138. la invitación dura 7 días y el enlace de restablecer 2 horas', async () => {
    const hash = await bcrypt.hash('x', 4);
    const { rows: [c] } = await query(`INSERT INTO colaboradores (nombre, usuario, password_hash) VALUES ('Persona de prueba seguridad', $1, $2) RETURNING id`, [USUARIO, hash]);
    await crearInvitacion({ nombre: 'Persona de prueba seguridad', usuario: USUARIO });
    await crearRestablecimiento(c.id);

    const { rows } = await query(`SELECT tipo, EXTRACT(EPOCH FROM (expira_en - now())) AS segundos FROM tokens_acceso WHERE usuario = $1 OR colaborador_id = $2`, [USUARIO, c.id]);
    const segundos = tipo => Number(rows.find(r => r.tipo === tipo).segundos);
    expect(segundos('invitacion')).toBeGreaterThan(6.9 * 24 * 3600);
    expect(segundos('invitacion')).toBeLessThanOrEqual(7 * 24 * 3600);
    expect(segundos('restablecimiento')).toBeGreaterThan(1.9 * 3600);
    expect(segundos('restablecimiento')).toBeLessThanOrEqual(2 * 3600);
  });
});

describe('las colaboradoras', () => {
  const crear = async (clave = 'clave-buena') => {
    const hash = await bcrypt.hash(clave, 4);
    const { rows: [c] } = await query(`INSERT INTO colaboradores (nombre, usuario, password_hash) VALUES ('Persona de prueba seguridad', $1, $2) RETURNING id`, [USUARIO, hash]);
    return c.id;
  };

  it('139. con la contraseña buena entra, y sin enseñar nunca la huella de la contraseña', async () => {
    await crear();

    const c = await verificarColaborador(USUARIO, 'clave-buena');

    expect(c).toMatchObject({ usuario: USUARIO, rol: 'colaborador', estado: 'activo' });
    expect(c.password_hash).toBeUndefined();
  });

  it('140. con una contraseña mala, vacía, o un usuario que no existe, no entra', async () => {
    await crear();

    expect(await verificarColaborador(USUARIO, 'otra-clave')).toBeNull();
    expect(await verificarColaborador(USUARIO, '')).toBeNull();
    expect(await verificarColaborador(USUARIO, undefined)).toBeNull();
    expect(await verificarColaborador('no-existe@ejemplo.test', 'clave-buena')).toBeNull();
  });

  it('141. el estado solo puede ser activo o inactivo', async () => {
    const id = await crear();

    await expect(actualizarEstadoColaborador(id, 'borrado')).rejects.toMatchObject({ status: 400 });
    await actualizarEstadoColaborador(id, 'inactivo');
    expect((await obtenerColaborador(id)).estado).toBe('inactivo');
  });

  it('142. dar de alta a alguien nuevo crea su invitación sin mandar ningún correo real', async () => {
    const registro = vi.spyOn(console, 'log').mockImplementation(() => {});

    const alta = await altaColaborador({ nombre: 'Persona de prueba seguridad', usuario: USUARIO, invitadoPor: null });

    expect(alta.yaExistia).toBe(false);
    expect(alta.enlace).toMatch(/\/invitacion\/[0-9a-f]{64}$/);
    expect(registro.mock.calls.some(l => String(l[0]).includes('no se envía correo real'))).toBe(true);
    const { rows } = await query(`SELECT 1 FROM tokens_acceso WHERE usuario = $1 AND tipo = 'invitacion'`, [USUARIO]);
    expect(rows).toHaveLength(1);
  });

  it('143. si ya existe, no se le invita otra vez, y se le puede dar el permiso de facturas generales', async () => {
    const id = await crear();

    const alta = await altaColaborador({ nombre: 'Persona de prueba seguridad', usuario: USUARIO, puedeSubirFacturasGenerales: true });

    expect(alta.yaExistia).toBe(true);
    expect((await obtenerColaborador(id)).puede_subir_facturas_generales).toBe(true);
    const { rows } = await query(`SELECT 1 FROM tokens_acceso WHERE usuario = $1`, [USUARIO]);
    expect(rows).toHaveLength(0);
  });
});
