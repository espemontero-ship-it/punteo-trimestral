import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { fetchDeMentira } from './ayuda-pantalla.js';
import LoginPage from '../app/login/page.js';
import RecuperarPage from '../app/recuperar/page.js';
import RestablecerPage from '../app/restablecer/[token]/page.js';
import InvitacionPage from '../app/invitacion/[token]/page.js';

const router = { push: vi.fn(), refresh: vi.fn() };
vi.mock('next/navigation', () => ({ useRouter: () => router }));

let red;
beforeEach(() => { red = fetchDeMentira(); router.push.mockClear(); router.refresh.mockClear(); });
afterEach(() => { vi.unstubAllGlobals(); });

const respuesta = (ok, datos, status = ok ? 200 : 400) => vi.fn(async () => ({ ok, status, json: async () => datos }));
const escribir = (marcador, valor) => fireEvent.change(screen.getByPlaceholderText(marcador), { target: { value: valor } });
const conParams = token => {
  const valor = { token };
  return Object.assign(Promise.resolve(valor), { status: 'fulfilled', value: valor });
};

describe('la página de entrada', () => {
  it('300. pide correo y contraseña, y tiene el enlace de "olvidé mi contraseña"', () => {
    render(<LoginPage />);

    expect(screen.getByPlaceholderText('Email')).toBeTruthy();
    expect(screen.getByPlaceholderText('Password').type).toBe('password');
    expect(screen.getByRole('link', { name: 'Forgot your password?' }).getAttribute('href')).toBe('/recuperar');
  });

  it('301. al entrar manda el correo sin espacios y la contraseña, y lleva a donde diga el servidor', async () => {
    red = fetchDeMentira({ '/api/login': { ok: true, redirect: '/colaborador' } });
    render(<LoginPage />);

    escribir('Email', '  ana@ejemplo.test ');
    escribir('Password', 'mi-clave');
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));

    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/colaborador'));
    expect(red.hacia('/api/login')[0].cuerpo).toEqual({ usuario: 'ana@ejemplo.test', password: 'mi-clave' });
    expect(router.refresh).toHaveBeenCalled();
  });

  it('302. si el servidor dice que no, enseña su mensaje y no cambia de página', async () => {
    vi.stubGlobal('fetch', respuesta(false, { error: 'Usuario o contraseña incorrectos' }, 401));
    render(<LoginPage />);

    escribir('Email', 'ana@ejemplo.test');
    escribir('Password', 'mala');
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));

    expect(await screen.findByText('Usuario o contraseña incorrectos')).toBeTruthy();
    expect(router.push).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Log in' }).disabled).toBe(false);
  });
});

describe('la página de "olvidé mi contraseña"', () => {
  it('303. manda el correo, y después enseña el mensaje (el mismo exista o no la cuenta) en vez del formulario', async () => {
    red = fetchDeMentira({ '/api/recuperar': { ok: true, mensaje: 'Si existe, te llega un enlace.' } });
    render(<RecuperarPage />);

    escribir('Your email', ' ana@ejemplo.test ');
    fireEvent.click(screen.getByRole('button', { name: 'Send link' }));

    expect(await screen.findByText('Si existe, te llega un enlace.')).toBeTruthy();
    expect(red.hacia('/api/recuperar')[0].cuerpo).toEqual({ usuario: 'ana@ejemplo.test' });
    expect(screen.queryByPlaceholderText('Your email')).toBeNull();
    expect(screen.getByRole('link', { name: 'Back to login' }).getAttribute('href')).toBe('/login');
  });
});

describe('elegir una contraseña nueva', () => {
  it('304. si las dos no coinciden avisa y no manda nada', async () => {
    render(<RestablecerPage params={conParams('abc')} />);

    escribir('New password', 'una-clave-larga');
    escribir('Repeat the password', 'otra-clave-larga');
    fireEvent.click(screen.getByRole('button', { name: 'Save password' }));

    expect(await screen.findByText("The two passwords don't match.")).toBeTruthy();
    expect(red.hacia('/api/restablecer')).toHaveLength(0);
  });

  it('305. con las dos iguales la manda con el enlace, y al terminar ofrece volver a entrar', async () => {
    red = fetchDeMentira({ '/api/restablecer/abc': { ok: true } });
    render(<RestablecerPage params={conParams('abc')} />);

    escribir('New password', 'una-clave-larga');
    escribir('Repeat the password', 'una-clave-larga');
    fireEvent.click(screen.getByRole('button', { name: 'Save password' }));

    expect(await screen.findByText(/Password changed/)).toBeTruthy();
    expect(red.hacia('/api/restablecer/abc')[0].cuerpo).toEqual({ password: 'una-clave-larga' });
    expect(screen.getByRole('link', { name: 'log in' }).getAttribute('href')).toBe('/login');
  });

  it('306. si el enlace no vale enseña el error del servidor y deja volver a intentarlo', async () => {
    vi.stubGlobal('fetch', respuesta(false, { error: 'Este enlace no es válido o ya ha caducado.' }, 404));
    render(<RestablecerPage params={conParams('mal')} />);

    escribir('New password', 'una-clave-larga');
    escribir('Repeat the password', 'una-clave-larga');
    fireEvent.click(screen.getByRole('button', { name: 'Save password' }));

    expect(await screen.findByText('Este enlace no es válido o ya ha caducado.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save password' }).disabled).toBe(false);
  });
});

describe('aceptar una invitación', () => {
  it('307. mientras comprueba el enlace dice que está cargando; si no vale, lo explica', async () => {
    vi.stubGlobal('fetch', respuesta(false, { error: 'Este enlace no es válido o ya ha caducado.' }, 404));
    render(<InvitacionPage params={conParams('caducado')} />);

    expect(screen.getByText('Loading...')).toBeTruthy();
    expect(await screen.findByText('Invalid link')).toBeTruthy();
    expect(screen.queryByPlaceholderText('Password')).toBeNull();
  });

  it('308. con un enlace bueno saluda por su nombre y dice a qué proyecto la invitan', async () => {
    red = fetchDeMentira({ '/api/invitaciones/ok': { nombre: 'Ana', proyecto: 'Wield 2' } });
    render(<InvitacionPage params={conParams('ok')} />);

    expect(await screen.findByText('Hi, Ana')).toBeTruthy();
    expect(screen.getByText('Wield 2')).toBeTruthy();
  });

  it('309. si no hay proyecto, la invitación es para las facturas generales de la asociación', async () => {
    red = fetchDeMentira({ '/api/invitaciones/ok': { nombre: 'Ana', proyecto: null } });
    render(<InvitacionPage params={conParams('ok')} />);

    expect(await screen.findByText(/invited to upload invoices for NotOnlyLarp/)).toBeTruthy();
  });

  it('310. las dos contraseñas tienen que coincidir; al crear la cuenta lleva a la zona de la colaboradora', async () => {
    red = fetchDeMentira({ '/api/invitaciones/ok': { nombre: 'Ana', proyecto: null, redirect: '/colaborador' } });
    render(<InvitacionPage params={conParams('ok')} />);
    await screen.findByText('Hi, Ana');

    escribir('Password', 'una-clave-larga');
    escribir('Repeat the password', 'distinta-clave-larga');
    fireEvent.click(screen.getByRole('button', { name: 'Create my account' }));
    expect(await screen.findByText("The two passwords don't match.")).toBeTruthy();
    expect(red.hacia('/api/invitaciones/ok').filter(l => l.metodo === 'POST')).toHaveLength(0);

    escribir('Repeat the password', 'una-clave-larga');
    fireEvent.click(screen.getByRole('button', { name: 'Create my account' }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/colaborador'));
    expect(red.hacia('/api/invitaciones/ok').filter(l => l.metodo === 'POST')[0].cuerpo).toEqual({ password: 'una-clave-larga' });
  });
});
