import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { fetchDeMentira } from './ayuda-pantalla.js';
import TablaColaboradores from '../app/components/TablaColaboradores.js';
import SubirFacturaColaborador from '../app/components/SubirFacturaColaborador.js';
import ToastHost from '../app/components/ToastHost.js';
import { uploadPresigned } from '@vercel/blob/client';

vi.mock('@vercel/blob/client', () => ({
  uploadPresigned: vi.fn(async ruta => ({ url: `https://blob.test/${ruta}` })),
}));

let red;
beforeEach(() => { uploadPresigned.mockClear(); });
afterEach(() => { vi.unstubAllGlobals(); });

const lote = (cambios = {}) => ({
  id: 7, colaborador_id: 3, colaborador_nombre: 'Ana López', colaborador_usuario: 'ana@ejemplo.test', evento: 'Wield 2',
  colaborador_estado: 'activo', colaborador_puede_invitar: false, colaborador_puede_subir_facturas_generales: false, ...cambios,
});

describe('la tabla de colaboradores', () => {
  it('320. enseña una fila por colaboradora con su nombre (enlace a su lote), correo, proyecto y permisos', async () => {
    red = fetchDeMentira({ '/api/lotes': { lotes: [lote(), lote({ id: null, colaborador_id: 4, colaborador_nombre: 'Berta Gil', colaborador_usuario: 'berta@ejemplo.test', evento: null, colaborador_estado: 'inactivo', colaborador_puede_invitar: true })] } });
    render(<TablaColaboradores />);

    expect(await screen.findByRole('link', { name: 'Ana López' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Ana López' }).getAttribute('href')).toBe('/lotes/7');
    expect(screen.getByText('ana@ejemplo.test')).toBeTruthy();
    expect(screen.getByText('Wield 2')).toBeTruthy();
    expect(screen.getByText('Berta Gil')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Berta Gil' })).toBeNull();
    const selects = screen.getAllByRole('combobox');
    expect(selects.map(s => s.value)).toEqual(['activo', 'no', 'no', 'inactivo', 'si', 'no']);
  });

  it('321. cambiar el estado o un permiso manda solo ese cambio a esa colaboradora y recarga la lista', async () => {
    red = fetchDeMentira({ '/api/lotes': { lotes: [lote()] }, '/api/colaboradores/3': { ok: true } });
    render(<TablaColaboradores />);
    await screen.findByText('Ana López');
    const [estado, invitar, facturasNol] = screen.getAllByRole('combobox');

    fireEvent.change(estado, { target: { value: 'inactivo' } });
    await waitFor(() => expect(red.hacia('/api/colaboradores/3')).toHaveLength(1));
    fireEvent.change(invitar, { target: { value: 'si' } });
    await waitFor(() => expect(red.hacia('/api/colaboradores/3')).toHaveLength(2));
    fireEvent.change(facturasNol, { target: { value: 'si' } });
    await waitFor(() => expect(red.hacia('/api/colaboradores/3')).toHaveLength(3));

    const cambios = red.hacia('/api/colaboradores/3');
    expect(cambios.map(c => c.metodo)).toEqual(['PATCH', 'PATCH', 'PATCH']);
    expect(cambios.map(c => c.cuerpo)).toEqual([{ estado: 'inactivo' }, { puedeInvitar: true }, { puedeSubirFacturasGenerales: true }]);
    await waitFor(() => expect(red.hacia('/api/lotes').filter(l => l.metodo === 'GET').length).toBeGreaterThanOrEqual(4));
  });

  it('322. invitar a alguien nuevo exige nombre y correo, y enseña el enlace por si el correo no está configurado', async () => {
    red = fetchDeMentira({ '/api/lotes': { lotes: [], ok: true, enlace: 'https://app.test/invitacion/abc123' } });
    render(<TablaColaboradores />);

    fireEvent.click(screen.getByRole('button', { name: '+ Añadir colaborador' }));
    fireEvent.click(screen.getByRole('button', { name: 'Invitar' }));
    expect(red.hacia('/api/lotes').filter(l => l.metodo === 'POST')).toHaveLength(0);

    fireEvent.change(screen.getByPlaceholderText('Nombre y apellidos'), { target: { value: 'Carla Ruiz' } });
    fireEvent.change(screen.getByPlaceholderText('correo@ejemplo.com'), { target: { value: 'carla@ejemplo.test' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Invitar' }));

    await waitFor(() => expect(red.hacia('/api/lotes').filter(l => l.metodo === 'POST')).toHaveLength(1));
    expect(red.hacia('/api/lotes').filter(l => l.metodo === 'POST')[0].cuerpo).toEqual({ nombre: 'Carla Ruiz', usuario: 'carla@ejemplo.test', puedeSubirFacturasGenerales: true });
    expect(await screen.findByRole('link', { name: 'https://app.test/invitacion/abc123' })).toBeTruthy();
  });

  it('323. si ya tenía cuenta lo dice, sin mandar ninguna invitación nueva', async () => {
    red = fetchDeMentira({ '/api/lotes': { lotes: [], ok: true, yaExistia: true, colaborador: { nombre: 'Ana López' } } });
    render(<TablaColaboradores />);

    fireEvent.click(screen.getByRole('button', { name: '+ Añadir colaborador' }));
    fireEvent.change(screen.getByPlaceholderText('Nombre y apellidos'), { target: { value: 'Ana López' } });
    fireEvent.change(screen.getByPlaceholderText('correo@ejemplo.com'), { target: { value: 'ana@ejemplo.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Invitar' }));

    expect(await screen.findByText(/Ana López ya tenía cuenta/)).toBeTruthy();
    expect(screen.queryByText(/Invitación enviada/)).toBeNull();
  });
});

const unPdf = (nombre = 'ticket.pdf', contenido = 'x') => new File([contenido], nombre, { type: 'application/pdf' });
const elegirArchivos = (contenedor, ...archivos) => fireEvent.change(contenedor.querySelector('input[type=file]'), { target: { files: archivos } });
const proyectos = { proyectos: [{ id: 5, nombre: 'Wield 2' }, { id: 6, nombre: 'Glitz 3' }] };

describe('subir una factura como colaboradora', () => {
  it('324. carga la lista de proyectos, y sin archivo o sin proyecto avisa antes de subir nada', async () => {
    red = fetchDeMentira({ '/api/colaborador/proyectos': proyectos });
    const { container } = render(<SubirFacturaColaborador onSubida={() => {}} />);
    expect(await screen.findByRole('option', { name: 'Wield 2' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Upload invoice' }));
    expect(await screen.findByText('Choose a file first.')).toBeTruthy();

    elegirArchivos(container, unPdf());
    fireEvent.click(screen.getByRole('button', { name: 'Upload invoice' }));
    expect(await screen.findByText('Choose a project first.')).toBeTruthy();
    expect(uploadPresigned).not.toHaveBeenCalled();
  });

  it('325. al subir la manda con su proyecto y descripción, avisa de cuántas se subieron y avisa al padre', async () => {
    const onSubida = vi.fn();
    red = fetchDeMentira({ '/api/colaborador/proyectos': proyectos, '/api/colaborador/facturas-generales': { tipo: 'lote', id: 9, numero: 12 } });
    const { container } = render(<SubirFacturaColaborador proyectoId="5" onSubida={onSubida} />);
    await screen.findByRole('option', { name: 'Glitz 3' });

    elegirArchivos(container, unPdf('gasolina.pdf'));
    fireEvent.change(screen.getByPlaceholderText(/Description/), { target: { value: 'gasolina' } });
    fireEvent.click(screen.getByRole('button', { name: 'Upload invoice' }));

    expect(await screen.findByText('1 invoice(s) uploaded.')).toBeTruthy();
    expect(uploadPresigned.mock.calls[0][2]).toEqual({ access: 'private', handleUploadUrl: '/api/blob-upload' });
    expect(red.hacia('/api/colaborador/facturas-generales')[0].cuerpo).toMatchObject({
      nombreOriginal: 'gasolina.pdf', concepto: 'gasolina', proyectoId: '5', quienPaga: 'colaborador',
    });
    expect(onSubida).toHaveBeenCalledTimes(1);
  });

  it('326. sin el permiso especial no ve el selector de quién paga y siempre paga ella; con él puede elegir que pague la asociación', async () => {
    red = fetchDeMentira({ '/api/colaborador/proyectos': proyectos, '/api/colaborador/facturas-generales': { tipo: 'lote' } });
    const sin = render(<SubirFacturaColaborador proyectoId="5" puedeSubirFacturasGenerales={false} onSubida={() => {}} />);
    await screen.findByRole('option', { name: 'Wield 2' });
    expect(screen.queryByRole('option', { name: 'NOL pays' })).toBeNull();
    sin.unmount();

    const { container } = render(<SubirFacturaColaborador proyectoId="5" puedeSubirFacturasGenerales onSubida={() => {}} />);
    await screen.findByRole('option', { name: 'NOL pays' });
    elegirArchivos(container, unPdf());
    fireEvent.change(screen.getByDisplayValue('I pay'), { target: { value: 'nol' } });
    fireEvent.click(screen.getByRole('button', { name: 'Upload invoice' }));

    await waitFor(() => expect(red.hacia('/api/colaborador/facturas-generales')).toHaveLength(1));
    expect(red.hacia('/api/colaborador/facturas-generales')[0].cuerpo.quienPaga).toBe('nol');
  });

  it('327. un archivo repetido no se sube y lo dice; un error del servidor sale con su mensaje; si la IA no leyó el importe lo avisa', async () => {
    const onSubida = vi.fn();
    red = fetchDeMentira({ '/api/colaborador/proyectos': proyectos, '/api/facturas/huella': { existe: true, numero: 3, nombre: 'x.pdf' } });
    const { container } = render(<SubirFacturaColaborador proyectoId="5" onSubida={onSubida} />);
    await screen.findByRole('option', { name: 'Wield 2' });

    elegirArchivos(container, unPdf('repetido.pdf'));
    fireEvent.click(screen.getByRole('button', { name: 'Upload invoice' }));
    expect(await screen.findByText('repetido.pdf: already uploaded.')).toBeTruthy();
    expect(uploadPresigned).not.toHaveBeenCalled();
    expect(onSubida).not.toHaveBeenCalled();
  });

  it('328. si el servidor rechaza la subida, enseña por qué y no avisa al padre', async () => {
    const onSubida = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async url => {
      const cuerpo = String(url).includes('/api/colaborador/proyectos') ? proyectos
        : String(url).includes('facturas-generales') ? { error: 'Este proyecto ya está cerrado.' } : { ok: true };
      return { ok: !String(url).includes('facturas-generales'), status: 409, json: async () => cuerpo };
    }));
    const { container } = render(<SubirFacturaColaborador proyectoId="5" onSubida={onSubida} />);
    await screen.findByRole('option', { name: 'Wield 2' });

    elegirArchivos(container, unPdf('tarde.pdf'));
    fireEvent.click(screen.getByRole('button', { name: 'Upload invoice' }));

    expect(await screen.findByText('tarde.pdf: Este proyecto ya está cerrado.')).toBeTruthy();
    expect(onSubida).not.toHaveBeenCalled();
  });
});
