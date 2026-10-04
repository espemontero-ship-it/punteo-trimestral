import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { fetchDeMentira } from './ayuda-pantalla.js';
import { ConfirmDialog, MotivoDialog } from '../app/components/ConfirmDialog.js';
import { Modal } from '../app/components/Modal.js';
import ToastHost from '../app/components/ToastHost.js';
import CabeceraApp, { PESTANAS } from '../app/components/CabeceraApp.js';
import GestionProyectos from '../app/components/GestionProyectos.js';
import SubirFactura from '../app/components/SubirFactura.js';
import SubirFacturasLote from '../app/components/SubirFacturasLote.js';
import { mostrarToast, apiFetch } from '../app/lib/toast.js';
import { uploadPresigned } from '@vercel/blob/client';

vi.mock('@vercel/blob/client', () => ({
  uploadPresigned: vi.fn(async ruta => ({ url: `https://blob.test/${ruta}` })),
}));

let red;
beforeEach(() => { red = fetchDeMentira(); uploadPresigned.mockClear(); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('los diálogos de confirmación', () => {
  it('270. cerrado no pinta nada; abierto enseña título, mensaje y los dos botones', () => {
    const { container, rerender } = render(<ConfirmDialog abierto={false} titulo="¿Seguro?" onConfirmar={() => {}} onCancelar={() => {}} />);
    expect(container.innerHTML).toBe('');

    rerender(<ConfirmDialog abierto titulo="¿Seguro?" mensaje="No se puede deshacer." textoConfirmar="Borrar" onConfirmar={() => {}} onCancelar={() => {}} />);

    expect(screen.getByText('¿Seguro?')).toBeTruthy();
    expect(screen.getByText('No se puede deshacer.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Borrar' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeTruthy();
  });

  it('271. confirmar y cancelar llaman a lo suyo, y pulsar fuera cancela pero pulsar dentro no', () => {
    const onConfirmar = vi.fn(); const onCancelar = vi.fn();
    const { container } = render(<ConfirmDialog abierto titulo="T" mensaje="M" onConfirmar={onConfirmar} onCancelar={onCancelar} />);

    fireEvent.click(screen.getByText('M'));
    expect(onCancelar).not.toHaveBeenCalled();
    fireEvent.click(container.querySelector('.dialogo-fondo'));
    expect(onCancelar).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onCancelar).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(onConfirmar).toHaveBeenCalledTimes(1);
  });

  it('272. sin mensaje no se pinta el párrafo vacío', () => {
    const { container } = render(<ConfirmDialog abierto titulo="Solo título" onConfirmar={() => {}} onCancelar={() => {}} />);

    expect(container.querySelector('.dialogo-cuerpo')).toBeNull();
  });

  it('273. el diálogo de motivo devuelve la opción elegida, o el texto escrito si es "otro", que no se puede confirmar vacío', () => {
    const onConfirmar = vi.fn();
    render(<MotivoDialog abierto titulo="Motivo" opciones={['Ilegible', 'Duplicada']} onConfirmar={onConfirmar} onCancelar={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(onConfirmar).toHaveBeenLastCalledWith('Ilegible');

    fireEvent.click(screen.getByText('Duplicada'));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(onConfirmar).toHaveBeenLastCalledWith('Duplicada');

    fireEvent.click(screen.getByText('Otro motivo'));
    expect(screen.getByRole('button', { name: 'Confirmar' }).disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText('Escribe el motivo'), { target: { value: '  no es de la asociación ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(onConfirmar).toHaveBeenLastCalledWith('no es de la asociación');
  });
});

describe('la ventana emergente', () => {
  it('274. cerrada no pinta nada; abierta enseña su título y su contenido, y se cierra con el botón o pulsando fuera', () => {
    const onCerrar = vi.fn();
    const { container, rerender } = render(<Modal abierto={false} titulo="Ventana" onCerrar={onCerrar}><p>dentro</p></Modal>);
    expect(container.innerHTML).toBe('');

    rerender(<Modal abierto titulo="Ventana" onCerrar={onCerrar} ancho={600}><p>dentro</p></Modal>);
    expect(screen.getByText('Ventana')).toBeTruthy();
    expect(screen.getByText('dentro')).toBeTruthy();
    expect(container.querySelector('.dialogo').style.maxWidth).toBe('600px');

    fireEvent.click(screen.getByText('dentro'));
    expect(onCerrar).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    fireEvent.click(container.querySelector('.dialogo-fondo'));
    expect(onCerrar).toHaveBeenCalledTimes(2);
  });
});

describe('los avisos', () => {
  it('275. un aviso aparece al pedirlo y desaparece solo; el de error tarda más', () => {
    vi.useFakeTimers();
    render(<ToastHost />);

    act(() => { mostrarToast('Guardado', 'ok'); mostrarToast('Algo falló', 'error'); });
    expect(screen.getByText('Guardado')).toBeTruthy();
    expect(screen.getByText('Algo falló')).toBeTruthy();

    act(() => { vi.advanceTimersByTime(3000); });
    expect(screen.queryByText('Guardado')).toBeNull();
    expect(screen.getByText('Algo falló')).toBeTruthy();

    act(() => { vi.advanceTimersByTime(2500); });
    expect(screen.queryByText('Algo falló')).toBeNull();
  });

  it('276. apiFetch devuelve los datos si todo va bien y avisa si lo pide', async () => {
    red = fetchDeMentira({ '/api/algo': { ok: true, dato: 7 } });
    render(<ToastHost />);

    const r = await apiFetch('/api/algo', undefined, { mensajeOk: 'Hecho' });

    expect(r).toEqual({ ok: true, dato: 7 });
    expect(await screen.findByText('Hecho')).toBeTruthy();
  });

  it('277. si el servidor responde con error, enseña el mensaje del servidor y devuelve null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 409, json: async () => ({ error: 'Ya existe.' }) })));
    render(<ToastHost />);

    const r = await apiFetch('/api/algo', undefined, { mensajeError: 'No se pudo.' });

    expect(r).toBeNull();
    expect(await screen.findByText('Ya existe.')).toBeTruthy();
  });

  it('278. sin mensaje del servidor usa el nuestro, y sin conexión lo dice', async () => {
    render(<ToastHost />);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => { throw new Error('no json'); } })));
    expect(await apiFetch('/x', undefined, { mensajeError: 'No se pudo guardar.' })).toBeNull();
    expect(await screen.findByText('No se pudo guardar.')).toBeTruthy();

    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('sin red'); }));
    expect(await apiFetch('/x')).toBeNull();
    expect(await screen.findByText('Sin conexión. Reintenta.')).toBeTruthy();
  });
});

describe('la cabecera con las pestañas', () => {
  it('279. enseña todas las pestañas, marca la activa y cambia al pulsar otra', () => {
    const onCambiarPestana = vi.fn();
    const { container } = render(<CabeceraApp pestanaActiva="facturas" onCambiarPestana={onCambiarPestana} cerrarSesion={() => {}} />);

    for (const p of PESTANAS) expect(screen.getAllByRole('button', { name: p.etiqueta }).length).toBeGreaterThan(0);
    expect(container.querySelector('.tabs-cabecera .activa').textContent).toBe('Facturas');

    fireEvent.click(container.querySelector('.tabs-cabecera').querySelectorAll('button')[1]);
    expect(onCambiarPestana).toHaveBeenCalledWith('movimientos');
  });

  it('280. cerrar sesión llama a lo suyo, y el menú del móvil se abre, cambia de pestaña y se cierra', () => {
    const onCambiarPestana = vi.fn(); const cerrarSesion = vi.fn();
    const { container } = render(<CabeceraApp pestanaActiva="inicio" onCambiarPestana={onCambiarPestana} cerrarSesion={cerrarSesion} />);

    fireEvent.click(container.querySelector('.cabecera-app').querySelector('button.secundario'));
    expect(cerrarSesion).toHaveBeenCalledTimes(1);

    expect(container.querySelector('.menu-movil-fondo')).toBeNull();
    fireEvent.click(screen.getByLabelText('Abrir menú'));
    const menu = container.querySelector('.menu-movil-lista');
    fireEvent.click([...menu.querySelectorAll('button')].find(b => b.textContent === 'Ayuda'));
    expect(onCambiarPestana).toHaveBeenCalledWith('ayuda');
    expect(container.querySelector('.menu-movil-fondo')).toBeNull();
  });

  it('281. fuera de la página principal las pestañas son enlaces que vuelven a ella', () => {
    const { container } = render(<CabeceraApp pestanaActiva="proyectos" cerrarSesion={() => {}} />);

    const enlaces = [...container.querySelectorAll('.tabs-cabecera a')].map(a => a.getAttribute('href'));
    expect(enlaces).toContain('/?tab=movimientos');
    expect(enlaces).toContain('/?tab=ayuda');
  });
});

describe('la lista de proyectos', () => {
  it('282. sin proyectos lo dice, y con proyectos cada uno es un enlace a su página', () => {
    const { rerender } = render(<GestionProyectos proyectos={[]} onCambio={() => {}} />);
    expect(screen.getByText('Todavía no hay ningún proyecto creado.')).toBeTruthy();

    rerender(<GestionProyectos proyectos={[{ id: 3, nombre: 'Wield 2' }]} onCambio={() => {}} />);
    expect(screen.getByRole('link', { name: 'Wield 2' }).getAttribute('href')).toBe('/proyectos/3');
  });

  it('283. crear un proyecto lo manda sin espacios sobrantes, avisa y recarga; con el nombre vacío no manda nada', async () => {
    const onCambio = vi.fn();
    render(<><ToastHost /><GestionProyectos proyectos={[]} onCambio={onCambio} /></>);

    fireEvent.click(screen.getByRole('button', { name: '+ Añadir proyecto' }));
    fireEvent.change(screen.getByPlaceholderText('Ej. Wield 2'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear' }));
    expect(red.hacia('/api/proyectos')).toHaveLength(0);

    fireEvent.change(screen.getByPlaceholderText('Ej. Wield 2'), { target: { value: '  Glitz 3  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear' }));

    await waitFor(() => expect(red.hacia('/api/proyectos')).toHaveLength(1));
    expect(red.hacia('/api/proyectos')[0].cuerpo).toEqual({ nombre: 'Glitz 3' });
    await waitFor(() => expect(onCambio).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Proyecto creado')).toBeTruthy();
  });
});

const unPdf = (nombre = 'factura.pdf', contenido = 'contenido') => new File([contenido], nombre, { type: 'application/pdf' });
const elegir = (contenedor, ...archivos) => fireEvent.change(contenedor.querySelector('input[type=file]'), { target: { files: archivos } });

describe('subir una factura desde el móvil o el ordenador', () => {
  it('284. el botón pide archivos, y al elegirlos enseña el formulario con cuántos son y se puede cancelar', () => {
    const { container } = render(<SubirFactura etiqueta="Subir ahora" onResultado={() => {}} />);
    expect(screen.getByRole('button', { name: /Subir ahora/ })).toBeTruthy();
    expect(container.querySelector('input[type=file]').multiple).toBe(true);

    elegir(container, unPdf('a.pdf'), unPdf('b.pdf'));
    expect(screen.getByText('2 archivos')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Subir 2' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.getByRole('button', { name: /Subir ahora/ })).toBeTruthy();
  });

  it('285. al subir, cada archivo va al almacén en privado y se manda a /api/facturas con sus datos, y el formulario se limpia', async () => {
    const onResultado = vi.fn();
    red = fetchDeMentira({ '/api/facturas': { tipo: 'ambiguo', detalle: 'una línea' } });
    const { container } = render(<SubirFactura hoja="bbva" clave="bolt" onResultado={onResultado} />);

    elegir(container, unPdf('bolt.pdf'));
    fireEvent.change(screen.getByPlaceholderText(/Concepto/), { target: { value: 'viajes' } });
    fireEvent.change(screen.getByPlaceholderText(/Importe/), { target: { value: '57.51' } });
    fireEvent.click(screen.getByRole('button', { name: 'Subir' }));

    await waitFor(() => expect(onResultado).toHaveBeenCalledTimes(1));
    expect(uploadPresigned).toHaveBeenCalledTimes(1);
    expect(uploadPresigned.mock.calls[0][0]).toMatch(/^facturas\/bbva-bolt-\d+-bolt\.pdf$/);
    expect(uploadPresigned.mock.calls[0][2]).toEqual({ access: 'private', handleUploadUrl: '/api/blob-upload' });
    expect(red.hacia('/api/facturas').filter(l => l.metodo === 'POST')[0].cuerpo).toMatchObject({
      hoja: 'bbva', clave: 'bolt', nombreOriginal: 'bolt.pdf', concepto: 'viajes', importe: '57.51', rutaBlob: expect.stringContaining('https://blob.test/'),
    });
    expect(onResultado).toHaveBeenCalledWith({ tipo: 'ambiguo', detalle: 'una línea' });
    await waitFor(() => expect(screen.queryByText('bolt.pdf')).toBeNull());
  });

  it('286. un archivo que ya estaba subido no se vuelve a subir: avisa con el número de la factura que ya lo tiene', async () => {
    const onResultado = vi.fn();
    red = fetchDeMentira({ '/api/facturas/huella': { existe: true, numero: 46, nombre: 'bolt.pdf' } });
    const { container } = render(<SubirFactura onResultado={onResultado} />);

    elegir(container, unPdf('copia.pdf'));
    fireEvent.click(screen.getByRole('button', { name: 'Subir' }));

    await waitFor(() => expect(onResultado).toHaveBeenCalledTimes(1));
    expect(onResultado.mock.calls[0][0]).toMatchObject({ tipo: 'duplicada' });
    expect(onResultado.mock.calls[0][0].detalle).toContain('#46');
    expect(uploadPresigned).not.toHaveBeenCalled();
  });

  it('287. si un archivo falla, avisa de cuál y sigue con el siguiente', async () => {
    const onResultado = vi.fn();
    uploadPresigned.mockRejectedValueOnce(new Error('sin cobertura'));
    const { container } = render(<SubirFactura onResultado={onResultado} />);

    elegir(container, unPdf('uno.pdf', 'aaa'), unPdf('dos.pdf', 'bbb'));
    fireEvent.click(screen.getByRole('button', { name: 'Subir 2' }));

    await waitFor(() => expect(onResultado).toHaveBeenCalledTimes(2));
    expect(onResultado.mock.calls[0][0]).toEqual({ tipo: 'error', detalle: 'uno.pdf: sin cobertura' });
    expect(onResultado.mock.calls[1][0]).toMatchObject({ ok: true });
    expect(uploadPresigned).toHaveBeenCalledTimes(2);
  });
});

describe('subir varias facturas de golpe', () => {
  it('288. sube todas, una a una, y al terminar entrega el resultado de cada una', async () => {
    const onCompletado = vi.fn();
    red = fetchDeMentira({ '/api/facturas': { tipo: 'sin_match', detalle: 'nada' } });
    const { container } = render(<SubirFacturasLote onCompletado={onCompletado} />);
    expect(screen.getByRole('button', { name: /Subir facturas/ })).toBeTruthy();

    elegir(container, unPdf('a.pdf', '1'), unPdf('b.pdf', '2'), unPdf('c.pdf', '3'));

    await waitFor(() => expect(onCompletado).toHaveBeenCalledTimes(1));
    const resultados = onCompletado.mock.calls[0][0];
    expect(resultados.map(r => r.nombreArchivo)).toEqual(['a.pdf', 'b.pdf', 'c.pdf']);
    expect(resultados.every(r => r.resultado.tipo === 'sin_match')).toBe(true);
    expect(uploadPresigned).toHaveBeenCalledTimes(3);
    expect(screen.getByRole('button', { name: /Subir facturas/ })).toBeTruthy();
  });

  it('289. los archivos repetidos no se suben y salen como duplicados; la ruta de destino se puede cambiar', async () => {
    const onCompletado = vi.fn();
    red = fetchDeMentira({ '/api/facturas/huella': { existe: true, numero: 12, nombre: 'vieja.pdf' }, '/api/colaborador/facturas': { tipo: 'lote' } });
    const { container } = render(<SubirFacturasLote onCompletado={onCompletado} endpoint="/api/colaborador/facturas" />);

    elegir(container, unPdf('repetida.pdf'));

    await waitFor(() => expect(onCompletado).toHaveBeenCalledTimes(1));
    expect(onCompletado.mock.calls[0][0][0].resultado).toMatchObject({ tipo: 'duplicada' });
    expect(onCompletado.mock.calls[0][0][0].resultado.detalle).toContain('#12');
    expect(uploadPresigned).not.toHaveBeenCalled();
  });

  it('290. un error en un archivo no para a los demás', async () => {
    const onCompletado = vi.fn();
    uploadPresigned.mockRejectedValueOnce(new Error('se cortó'));
    const { container } = render(<SubirFacturasLote onCompletado={onCompletado} />);

    elegir(container, unPdf('a.pdf', '1'), unPdf('b.pdf', '2'));

    await waitFor(() => expect(onCompletado).toHaveBeenCalledTimes(1));
    const [primera, segunda] = onCompletado.mock.calls[0][0];
    expect(primera.resultado).toEqual({ tipo: 'error', detalle: 'se cortó' });
    expect(segunda.resultado).toMatchObject({ ok: true });
  });
});
