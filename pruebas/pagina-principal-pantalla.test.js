import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import Home from '../app/page.js';
import Ayuda from '../app/components/Ayuda.js';
import ToastHost from '../app/components/ToastHost.js';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('@vercel/blob/client', () => ({ uploadPresigned: vi.fn() }));

const ENVIO = { movimientos: 2, facturas: 1, devoluciones: 0, importeTotal: -30 };
const ENVIOS_ANTERIORES = [{ id: 5, etiqueta: 'Julio-Septiembre', desde: null, hasta: '2026-09-30', creado_en: '2026-10-04T10:00:00.000Z', movimientos: 40, facturas: 12 }];
const IMPORTACIONES = [
  { id: 1, hoja: 'bbva', origen: 'banco', nombreArchivo: 'extracto.xlsx', creadoEn: '2026-10-01T00:00:00.000Z', total: 30, resueltas: 10 },
  { id: 2, hoja: 'larpmanager', origen: 'larpmanager', nombreArchivo: 'pagos.csv', creadoEn: '2026-10-02T00:00:00.000Z', total: 5, resueltas: 0 },
];

let llamadas;
function montarFetch(cambios = {}) {
  llamadas = [];
  const rutas = {
    '/api/movimientos-pendientes': { movimientos: [] },
    '/api/movimientos': { proveedores: [] },
    '/api/resumen': { total: 0, resueltas: 0, facturaFutura: 0, ignoradas: 0, porHoja: [] },
    '/api/facturas': { facturas: [] },
    '/api/proyectos': { proyectos: [] },
    '/api/envios/anteriores': { envios: ENVIOS_ANTERIORES },
    '/api/importaciones': { importaciones: IMPORTACIONES },
    '/api/larpmanager-sin-emparejar': { pagos: [] },
    '/api/lotes': { lotes: [] },
    ...cambios,
  };
  vi.stubGlobal('fetch', vi.fn(async (url, opciones = {}) => {
    const metodo = opciones.method || 'GET';
    llamadas.push({ url: String(url), metodo, cuerpo: opciones.body });
    const clave = Object.keys(rutas).filter(k => String(url).includes(k)).sort((a, b) => b.length - a.length)[0];
    const dato = clave ? rutas[clave] : { ok: true };
    const respuesta = typeof dato === 'function' ? dato({ url: String(url), metodo, opciones }) : dato;
    if (respuesta && respuesta.__zip) {
      return { ok: true, status: 200, blob: async () => new Blob(['zip'], { type: 'application/zip' }), json: async () => ({}) };
    }
    const { __status, ...cuerpo } = respuesta || {};
    return { ok: !__status, status: __status || 200, json: async () => cuerpo };
  }));
}
const hacia = (fragmento, metodo) => llamadas.filter(l => l.url.includes(fragmento) && (!metodo || l.metodo === metodo));
const abrirPestana = nombre => window.history.pushState({}, '', `/?tab=${nombre}`);
const pintar = () => render(<><ToastHost /><Home /></>);

beforeEach(() => {
  localStorage.clear();
  window.history.pushState({}, '', '/');
  URL.createObjectURL = vi.fn(() => 'blob:prueba');
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () { this.dataset.pulsado = '1'; });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('la página principal', () => {
  it('390. arranca en Inicio con el botón de subir una factura suelta, y la pestaña se elige con la dirección', async () => {
    montarFetch();
    pintar();

    expect(await screen.findByText('Subir factura suelta')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Subir ahora/ })).toBeTruthy();
  });

  it('391. la pestaña Movimientos enseña la barra de arriba con sus cinco botones, aunque no haya movimientos todavía', async () => {
    montarFetch();
    abrirPestana('movimientos');
    const { container } = pintar();

    await screen.findByText(/Todavía no hay movimientos/);
    const barra = container.querySelector('.bloques');
    const botones = [...barra.querySelectorAll('button')].map(b => b.textContent.replace('⬆', '').trim());
    expect(botones).toEqual(['Excel del banco', '📎 Subir facturas', 'Devoluciones', 'Archivos subidos', 'Enviar a gestoría']);
  });

  it('392. se cambia de pestaña desde la cabecera y cada una enseña lo suyo', async () => {
    montarFetch();
    pintar();
    await screen.findByText('Subir factura suelta');

    fireEvent.click(screen.getAllByRole('button', { name: 'Facturas' })[0]);
    expect(await screen.findByRole('button', { name: /Subir facturas/ })).toBeTruthy();

    fireEvent.click(screen.getAllByRole('button', { name: 'Proyectos' })[0]);
    expect(await screen.findByText('Todavía no hay ningún proyecto creado.')).toBeTruthy();

    fireEvent.click(screen.getAllByRole('button', { name: 'Ayuda' })[0]);
    expect(await screen.findByText('Administración')).toBeTruthy();
  });
});

describe('Enviar a gestoría', () => {
  const abrirEnvio = async (cambios = {}) => {
    montarFetch({ '/api/envios?hasta': ENVIO, ...cambios });
    abrirPestana('movimientos');
    pintar();
    await screen.findByText(/Todavía no hay movimientos/);
    fireEvent.click(screen.getByRole('button', { name: 'Enviar a gestoría' }));
    await screen.findByText(/2 movimiento\(s\) · 1 factura\(s\)/);
  };

  it('393. enseña el resumen de lo pendiente, dos botones distintos y la lista de envíos anteriores', async () => {
    await abrirEnvio();

    expect(screen.getByText('2 movimiento(s) · 1 factura(s) · 0 devolución(es) · -30.00€')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Descargar archivo' }).disabled).toBe(false);
    expect(screen.getByRole('button', { name: 'Marcar como enviado' }).disabled).toBe(false);
    expect(screen.getByText('Envíos anteriores')).toBeTruthy();
    expect(await screen.findByText('Julio-Septiembre')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Volver a descargar' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Deshacer envío' })).toBeTruthy();
  });

  it('394. "Descargar archivo" genera el zip con su etiqueta y NO marca nada como enviado', async () => {
    await abrirEnvio({ '/api/envios/descargar': { __zip: true } });
    fireEvent.change(screen.getByPlaceholderText(/Etiqueta/), { target: { value: 'Enero-Marzo 2026' } });

    fireEvent.click(screen.getByRole('button', { name: 'Descargar archivo' }));

    await waitFor(() => expect(hacia('/api/envios/descargar', 'POST')).toHaveLength(1));
    expect(JSON.parse(hacia('/api/envios/descargar')[0].cuerpo)).toMatchObject({ etiqueta: 'Enero-Marzo 2026' });
    expect(await screen.findByText('Descarga lista. No se ha marcado nada como enviado.')).toBeTruthy();
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(hacia('/api/envios', 'POST').filter(l => l.url.endsWith('/api/envios'))).toHaveLength(0);
  });

  it('395. "Marcar como enviado" pide confirmación diciendo cuántos se marcan, y al confirmar los marca sin descargar nada', async () => {
    await abrirEnvio({ '/api/envios': ({ metodo }) => (metodo === 'POST' ? { ok: true, envioId: 9, movimientos: 2, facturas: 1 } : ENVIO) });
    fireEvent.change(screen.getByPlaceholderText(/Etiqueta/), { target: { value: 'Octubre' } });

    fireEvent.click(screen.getByRole('button', { name: 'Marcar como enviado' }));
    expect(screen.getByText('¿Marcar como enviado?')).toBeTruthy();
    expect(screen.getByText(/Los 2 movimiento\(s\) y 1 factura\(s\) de este envío quedan marcados/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Marcar como enviado' }).at(-1));

    await waitFor(() => expect(hacia('/api/envios', 'POST').filter(l => l.url.endsWith('/api/envios'))).toHaveLength(1));
    expect(JSON.parse(hacia('/api/envios', 'POST').filter(l => l.url.endsWith('/api/envios'))[0].cuerpo)).toMatchObject({ etiqueta: 'Octubre' });
    expect(await screen.findByText('Marcado como enviado: 2 movimiento(s) y 1 factura(s).')).toBeTruthy();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('396. cancelar la confirmación no marca nada', async () => {
    await abrirEnvio();

    fireEvent.click(screen.getByRole('button', { name: 'Marcar como enviado' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(hacia('/api/envios', 'POST').filter(l => l.url.endsWith('/api/envios'))).toHaveLength(0);
  });

  it('397. "Volver a descargar" regenera el archivo de ese envío sin tocar nada', async () => {
    await abrirEnvio({ '/api/envios/5/descargar': { __zip: true } });
    await screen.findByText('Julio-Septiembre');

    fireEvent.click(screen.getByRole('button', { name: 'Volver a descargar' }));

    await waitFor(() => expect(hacia('/api/envios/5/descargar', 'GET')).toHaveLength(1));
    expect(await screen.findByText('Descarga lista.')).toBeTruthy();
    expect(hacia('/deshacer')).toHaveLength(0);
  });

  it('398. "Deshacer envío" avisa de que no se borra nada, y al confirmar lo deshace', async () => {
    await abrirEnvio({ '/api/envios/5/deshacer': { ok: true, movimientos: 40, facturas: 12 } });
    await screen.findByText('Julio-Septiembre');

    fireEvent.click(screen.getByRole('button', { name: 'Deshacer envío' }));
    expect(screen.getByText(/No se borra nada: solo deja de contar como enviado/)).toBeTruthy();
    expect(screen.getByText(/Sus 40 movimiento\(s\) y 12 factura\(s\) vuelven a quedar pendientes/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Deshacer envío' }).at(-1));

    await waitFor(() => expect(hacia('/api/envios/5/deshacer', 'POST')).toHaveLength(1));
    expect(await screen.findByText(/Envío deshecho: 40 movimiento\(s\) y 12 factura\(s\) vuelven a estar pendientes/)).toBeTruthy();
  });

  it('399. si no hay nada pendiente, no se puede descargar ni marcar', async () => {
    montarFetch({ '/api/envios?hasta': { movimientos: 0, facturas: 0, devoluciones: 0, importeTotal: 0 } });
    abrirPestana('movimientos');
    pintar();
    await screen.findByText(/Todavía no hay movimientos/);

    fireEvent.click(screen.getByRole('button', { name: 'Enviar a gestoría' }));

    expect(await screen.findByText('No hay nada pendiente de enviar hasta esa fecha.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Descargar archivo' }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Marcar como enviado' }).disabled).toBe(true);
  });

  it('400. si la descarga falla, enseña el error del servidor y no dice que ha ido bien', async () => {
    await abrirEnvio({ '/api/envios/descargar': { __status: 500, error: 'No se pudo descargar el excel original.' } });

    fireEvent.click(screen.getByRole('button', { name: 'Descargar archivo' }));

    expect(await screen.findByText('No se pudo descargar el excel original.')).toBeTruthy();
    expect(screen.queryByText(/Descarga lista/)).toBeNull();
  });
});

describe('subir el excel del banco y ver las subidas', () => {
  it('401. el selector acepta los tres formatos, y por defecto el banco se detecta solo', async () => {
    montarFetch();
    abrirPestana('movimientos');
    pintar();
    await screen.findByText(/Todavía no hay movimientos/);

    fireEvent.click(screen.getByRole('button', { name: /Excel del banco/ }));

    const entrada = document.querySelector('input[type=file][name=file]');
    expect(entrada.accept).toBe('.xlsx,.xls,.csv');
    const desplegable = document.querySelector('select[name=hoja]');
    expect(desplegable.value).toBe('');
    expect([...desplegable.options].map(o => o.textContent)).toEqual([
      'Detectar automáticamente', 'Es un export suelto de bbva', 'Es un export suelto de openbank', 'Es un export suelto de paypal',
    ]);
  });

  it('402. "Archivos subidos" lista las subidas, y borrar una avisa de lo que se pierde y manda el borrado', async () => {
    montarFetch({ '/api/importaciones/1': { ok: true } });
    abrirPestana('movimientos');
    pintar();
    await screen.findByText(/Todavía no hay movimientos/);

    fireEvent.click(screen.getByRole('button', { name: 'Archivos subidos' }));
    expect(await screen.findByText('extracto.xlsx')).toBeTruthy();
    expect(screen.getByText('pagos.csv')).toBeTruthy();

    fireEvent.click(screen.getAllByRole('button', { name: 'Borrar' })[0]);
    expect(screen.getByText(/10 de ellos ya están resueltos y se perderán sus notas\/facturas emparejadas/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Borrar' }).at(-1));

    await waitFor(() => expect(hacia('/api/importaciones/1', 'DELETE')).toHaveLength(1));
  });
});

describe('la pantalla de Ayuda', () => {
  it('403. enseña todas las secciones de administración y cambia a la versión para colaboradores', () => {
    render(<Ayuda />);

    const titulos = [...document.querySelectorAll('section.seccion-ayuda h3')].map(h => h.textContent);
    expect(titulos.length).toBeGreaterThanOrEqual(6);
    expect(titulos).toEqual(['Entrar', 'Inicio', 'Movimientos', 'Facturas', 'LarpManager', 'Proyectos', 'Colaboradores']);
    expect(titulos.every(t => t.trim().length > 0)).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Colaboradores' }));
    const ingles = [...document.querySelectorAll('section.seccion-ayuda h3')].map(h => h.textContent);
    expect(ingles).not.toEqual(titulos);
    expect(ingles).toContain('Inviting someone else');
  });

  it('404. la versión solo para colaboradoras no lleva el interruptor y está en inglés', () => {
    render(<Ayuda soloColaboradores />);

    expect(screen.queryByRole('button', { name: 'Administración' })).toBeNull();
    expect(document.querySelectorAll('section.seccion-ayuda').length).toBeGreaterThanOrEqual(3);
  });

  it('405. la Ayuda explica los botones y los gestos que existen en la app', () => {
    render(<Ayuda />);
    const texto = document.body.textContent;

    for (const frase of [
      'Subir facturas', 'Recalcular sugerencias', 'Desvincular factura', 'Enviar a gestoría', 'Descargar archivo',
      'Marcar como enviado', 'Volver a descargar', 'Deshacer envío', 'Buscar en cualquier columna', 'Detectar automáticamente',
    ]) {
      expect(texto, `la Ayuda no menciona «${frase}»`).toContain(frase);
    }
  });

  it('406. la Ayuda ya no habla de cosas que se quitaron', () => {
    render(<Ayuda />);
    const texto = document.body.textContent;

    expect(texto).not.toContain('Recalcular facturas sin resolver');
    expect(texto).not.toContain('aquí sale el botón Subir');
    expect(texto).not.toContain('Leer con IA');
    expect(texto).not.toContain('Es una imagen, no se puede leer');
    expect(texto).not.toContain('Deja el campo de usuario en blanco');
    expect(texto).not.toContain('collaborators only');
    expect(texto).not.toContain('The password field on its own');
  });

  it('407. la Ayuda cuenta cómo se entra de verdad: correo y contraseña, con "Forgot your password?"', () => {
    render(<Ayuda />);
    const entrar = [...document.querySelectorAll('section.seccion-ayuda')].find(s => s.querySelector('h3').textContent === 'Entrar');

    expect(entrar.textContent).toContain('correo');
    expect(entrar.textContent).toContain('contraseña');
    expect(entrar.textContent).toContain('Forgot your password?');
  });

  it('408. la Ayuda explica lo decidido sobre confirmar un grupo y sobre los ingresos que ya estaban resueltos', () => {
    render(<Ayuda />);
    const texto = document.body.textContent;

    expect(texto).toContain('Confirmar un grupo solo toca las líneas pendientes');
    expect(texto).toContain('Nunca cierra una línea sola');
    expect(texto).toContain('ya estaba resuelto cuando subes el CSV');
  });

  it('409. la Ayuda de las colaboradoras no pide campos que el formulario no tiene (importe y fecha se leen de la factura)', () => {
    render(<Ayuda soloColaboradores />);
    const texto = document.body.textContent;

    expect(texto).not.toContain('what you paid');
    expect(texto).not.toContain('when you paid it');
    expect(texto).toContain('read from the invoice itself');
  });

  it('410. cada botón que la Ayuda nombra existe de verdad en la app', () => {
    const fuentes = ['app/page.js', 'app/components/TablaMovimientos.js', 'app/components/FacturasTrimestre.js', 'app/components/PagosLarpManager.js', 'app/components/SubirFacturasLote.js', 'app/components/GestionProyectos.js', 'app/components/TablaColaboradores.js', 'app/login/page.js']
      .map(ruta => fs.readFileSync(path.join(process.cwd(), ruta), 'utf8')).join('\n');

    for (const boton of [
      'Excel del banco', 'Subir facturas', 'Devoluciones', 'Archivos subidos', 'Enviar a gestoría', 'Descargar archivo',
      'Marcar como enviado', 'Volver a descargar', 'Deshacer envío', 'Recalcular sugerencias', 'Descargar CSV',
      'Borrar seleccionadas', 'Subir pagos de LarpManager', 'Reagrupar proveedores', 'Agrupar proveedores', 'Solo pendientes',
      'Desvincular factura', 'Detectar automáticamente', 'Añadir proyecto', 'Añadir colaborador', 'Forgot your password?',
    ]) {
      expect(fuentes, `la Ayuda nombra «${boton}» pero no está en la app`).toContain(boton);
    }
  });
});
