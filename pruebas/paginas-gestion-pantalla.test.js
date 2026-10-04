import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { fetchDeMentira, unaFacturaDeLote, unPago } from './ayuda-pantalla.js';
import ProyectosPage from '../app/proyectos/page.js';
import ProyectoPage from '../app/proyectos/[id]/page.js';
import LotePage from '../app/lotes/[id]/page.js';
import ColaboradorPage from '../app/colaborador/page.js';

const router = { push: vi.fn(), refresh: vi.fn() };
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('@vercel/blob/client', () => ({ uploadPresigned: vi.fn() }));

let red;
beforeEach(() => { router.push.mockClear(); router.refresh.mockClear(); });
afterEach(() => { vi.unstubAllGlobals(); });

const conParams = valores => Object.assign(Promise.resolve(valores), { status: 'fulfilled', value: valores });
const respuestas = tabla => vi.fn(async (url, opciones = {}) => {
  const clave = Object.keys(tabla).find(k => String(url).includes(k));
  const datos = clave ? (typeof tabla[clave] === 'function' ? tabla[clave](opciones) : tabla[clave]) : { ok: true };
  const { __status, ...cuerpo } = datos;
  return { ok: !__status, status: __status || 200, json: async () => cuerpo };
});

describe('la pestaña de proyectos', () => {
  it('330. carga la lista y la enseña, y mientras tanto dice que está cargando', async () => {
    red = fetchDeMentira({ '/api/proyectos': { proyectos: [{ id: 3, nombre: 'Wield 2', estado: 'abierto' }] } });
    render(<ProyectosPage />);

    expect(screen.getByText('Cargando...')).toBeTruthy();
    expect(await screen.findByRole('link', { name: 'Wield 2' })).toBeTruthy();
  });
});

describe('la página de un proyecto', () => {
  const montar = (cambios = {}) => {
    red = fetchDeMentira({
      '/api/proyectos/3/devoluciones': { devoluciones: [] },
      '/api/proyectos/3/facturas-futuras': { facturas: [] },
      '/api/proyectos/3/facturas-lote': { facturas: [] },
      '/api/proyectos': { proyectos: [{ id: 3, nombre: 'Wield 2', estado: 'abierto' }] },
      ...cambios,
    });
    return render(<ProyectoPage params={conParams({ id: '3' })} />);
  };

  it('331. enseña el proyecto abierto con sus tres listas vacías y avisos claros', async () => {
    montar();

    expect(await screen.findByText('Wield 2')).toBeTruthy();
    expect(screen.getByText('Pendientes de cierre')).toBeTruthy();
    expect(await screen.findByText('Ninguna devolución de este proyecto todavía.')).toBeTruthy();
    expect(screen.getByText('Ninguna factura futura pendiente de este proyecto.')).toBeTruthy();
    expect(screen.getByText('Ninguna factura de colaborador pendiente de este proyecto.')).toBeTruthy();
  });

  it('332. enseña las devoluciones, las facturas futuras y las facturas de colaboradoras con sus importes', async () => {
    montar({
      '/api/proyectos/3/devoluciones': { devoluciones: [{ id: 1, fecha: '2026-09-10T00:00:00.000Z', importe: '-30.00', jugador_larpmanager: 'Aine Sweeney', nota_final: 'refund' }] },
      '/api/proyectos/3/facturas-futuras': { facturas: [{ id: 2, fecha: '2026-09-11T00:00:00.000Z', importe: '-40.00', proveedor: 'Iberia', concepto: 'vuelo' }] },
      '/api/proyectos/3/facturas-lote': { facturas: [
        { id: 3, colaborador_nombre: 'Ana López', concepto: 'gasolina', importe_declarado: 22.5, pagado_por: 'colaborador', estado_revision: 'aceptada' },
        { id: 4, colaborador_nombre: 'Berta Gil', concepto: 'cinta', importe_declarado: null, pagado_por: 'nol', estado_revision: 'revisar' },
      ] },
    });

    expect(await screen.findByText('Aine Sweeney')).toBeTruthy();
    expect(screen.getByText('-30.00€')).toBeTruthy();
    expect(screen.getByText('Iberia')).toBeTruthy();
    expect(screen.getByText('22.50€')).toBeTruthy();
    expect(screen.getAllByText('Colaborador')).toHaveLength(2);
    expect(screen.getByText('NOL')).toBeTruthy();
    expect(screen.getByText('Aceptada')).toBeTruthy();
    expect(screen.getByText('Sin revisar')).toBeTruthy();
  });

  it('333. cerrar el proyecto pide confirmación y avisa de lo que pasa; al confirmar lo cierra, y cancelar no hace nada', async () => {
    montar({ '/api/proyectos/3/cerrar': { ok: true } });
    await screen.findByText('Wield 2');

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar proyecto' }));
    expect(screen.getByText(/no podrán subir más facturas/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(red.hacia('/cerrar')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar proyecto' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    await waitFor(() => expect(red.hacia('/api/proyectos/3/cerrar')).toHaveLength(1));
    expect(red.hacia('/api/proyectos/3/cerrar')[0].metodo).toBe('POST');
  });

  it('334. un proyecto cerrado lo dice y ya no ofrece cerrarlo', async () => {
    montar({ '/api/proyectos': { proyectos: [{ id: 3, nombre: 'Wield 2', estado: 'cerrado' }] } });

    expect(await screen.findByText('Cerrado')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cerrar proyecto' })).toBeNull();
  });
});

describe('la página de un lote (administración)', () => {
  const lote = { id: 7, evento: 'Wield 2', colaborador_nombre: 'Ana López', proyecto_estado: 'abierto' };
  const totales = { totalAceptado: 45, totalPagado: 0, totalRechazado: 0, totalConciliado: 0, pendienteDePagar: 45 };
  const montar = (facturas = [unaFacturaDeLote({ id: 11, concepto: 'gasolina' })], extra = {}) => {
    vi.stubGlobal('fetch', respuestas({
      '/api/lotes/7/facturas/': { ok: true }, '/api/lotes/7/anticipos': { ok: true }, '/api/lotes/7/pagar': { ok: true },
      '/api/lotes/7': { lote, facturas, pagos: [], totales },
      ...extra,
    }));
    return render(<LotePage params={conParams({ id: '7' })} />);
  };
  const llamadas = fragmento => fetch.mock.calls.filter(([url]) => String(url).includes(fragmento));

  it('335. enseña el proyecto, de quién es el lote y sus facturas', async () => {
    montar();

    expect(await screen.findByText('Wield 2')).toBeTruthy();
    expect(screen.getByText('Ana López')).toBeTruthy();
    expect(screen.getByText('gasolina')).toBeTruthy();
  });

  it('336. rechazar una factura pide el motivo y manda el estado y el motivo elegidos', async () => {
    const { container } = montar();
    await screen.findByText('gasolina');

    fireEvent.change(container.querySelector('select.select-estado'), { target: { value: 'rechazada' } });
    expect(screen.getByText('Rechazar factura')).toBeTruthy();
    fireEvent.click(screen.getByText('Duplicada'));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));

    await waitFor(() => expect(llamadas('/api/lotes/7/facturas/11')).toHaveLength(1));
    const [, opciones] = llamadas('/api/lotes/7/facturas/11')[0];
    expect(opciones.method).toBe('PATCH');
    expect(JSON.parse(opciones.body)).toEqual({ estadoRevision: 'rechazada', motivoRechazo: 'Duplicada' });
  });

  it('337. borrar una factura pide confirmación y avisa de que no se elimina del histórico', async () => {
    const { container } = montar();
    await screen.findByText('gasolina');

    fireEvent.change(container.querySelector('select.select-estado'), { target: { value: 'borrada' } });
    expect(screen.getByText('No se elimina del histórico, pero desaparece de las cuentas.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Borrar' }));

    await waitFor(() => expect(llamadas('/api/lotes/7/facturas/11')).toHaveLength(1));
    expect(llamadas('/api/lotes/7/facturas/11')[0][1].method).toBe('DELETE');
  });

  it('338. pagar manda las facturas aceptadas, y añadir un anticipo manda el importe y si es en efectivo', async () => {
    montar([unaFacturaDeLote({ id: 11 }), unaFacturaDeLote({ id: 12 })]);
    await screen.findByText('Wield 2');

    fireEvent.click(screen.getByRole('button', { name: 'Pagar' }));
    await waitFor(() => expect(llamadas('/api/lotes/7/pagar')).toHaveLength(1));
    expect(JSON.parse(llamadas('/api/lotes/7/pagar')[0][1].body).facturaIds.sort()).toEqual([11, 12]);

    fireEvent.click(screen.getByRole('button', { name: '+ Añadir anticipo' }));
    fireEvent.change(screen.getByPlaceholderText('Ej. 50'), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.submit(screen.getByRole('button', { name: 'Añadir' }).closest('form'));
    await waitFor(() => expect(llamadas('/api/lotes/7/anticipos')).toHaveLength(1));
    expect(JSON.parse(llamadas('/api/lotes/7/anticipos')[0][1].body)).toMatchObject({ importe: '30', esEfectivo: true });
  });

  it('339. un proyecto cerrado no deja pagar ni añadir anticipos', async () => {
    montar(undefined, { '/api/lotes/7': { lote: { ...lote, proyecto_estado: 'cerrado' }, facturas: [unaFacturaDeLote()], pagos: [], totales } });

    await screen.findByText('Wield 2');
    expect(screen.queryByRole('button', { name: 'Pagar' })).toBeNull();
    expect(screen.queryByRole('button', { name: '+ Añadir anticipo' })).toBeNull();
  });
});

describe('la página de la colaboradora', () => {
  const base = { nombre: 'Ana', lotes: [], puedeInvitar: false, puedeSubirFacturasGenerales: false };
  const montar = (cambios = {}, extra = {}) => {
    vi.stubGlobal('fetch', respuestas({
      '/api/colaborador/proyectos': { proyectos: [{ id: 5, nombre: 'Wield 2' }] },
      '/api/colaborador/lotes/7': { lote: { id: 7, evento: 'Wield 2', proyecto_id: 5, proyecto_estado: 'abierto' }, facturas: [unaFacturaDeLote({ concepto: 'gasolina' })], pagos: [unPago()], totales: { totalAceptado: 45, totalPagado: 0, totalRechazado: 0, totalConciliado: 0, pendienteDePagar: 45 } },
      '/api/colaborador/lotes': { ...base, ...cambios },
      ...extra,
    }));
    return render(<ColaboradorPage />);
  };
  const llamadas = fragmento => fetch.mock.calls.filter(([url]) => String(url).includes(fragmento));

  it('340. saluda por su nombre, enseña los datos de facturación de la asociación y el formulario de subida', async () => {
    montar();

    expect(await screen.findByText('Hi, Ana')).toBeTruthy();
    expect(screen.getByText('Details for the invoice')).toBeTruthy();
    expect(screen.getByText(/G87705794/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Upload invoice' })).toBeTruthy();
  });

  it('341. con un solo proyecto lo abre directamente; con varios enseña la lista con lo subido en cada uno', async () => {
    montar({ lotes: [{ id: 7, evento: 'Wield 2', total_subido: 45 }] });
    expect(await screen.findByText('gasolina')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Switch project' })).toBeTruthy();
  });

  it('342. con varios proyectos enseña cada uno con lo que lleva subido, y al pulsar uno lo abre', async () => {
    montar({ lotes: [{ id: 7, evento: 'Wield 2', total_subido: 45 }, { id: 8, evento: 'Glitz 3', total_subido: 12.5 }] });

    expect(await screen.findByText('45.00€ uploaded')).toBeTruthy();
    expect(screen.getByText('12.50€ uploaded')).toBeTruthy();
    expect(screen.queryByText('gasolina')).toBeNull();
    fireEvent.click(screen.getByText('45.00€ uploaded').closest('.tarjeta'));
    expect(await screen.findByText('gasolina')).toBeTruthy();
  });

  it('343. la ayuda se abre y se cierra, y es la de las colaboradoras', async () => {
    montar();
    await screen.findByText('Hi, Ana');

    fireEvent.click(screen.getByRole('button', { name: 'Help' }));
    expect(screen.getByRole('heading', { name: 'Help' })).toBeTruthy();
    expect(screen.queryByText(/Without an invoice made out to these details/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText(/Without an invoice made out to these details/)).toBeTruthy();
  });

  it('344. salir cierra la sesión y lleva al login', async () => {
    montar();
    await screen.findByText('Hi, Ana');

    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));

    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/login'));
    expect(llamadas('/api/logout')[0][1].method).toBe('POST');
  });

  it('345. quien no tiene permiso para invitar no ve el formulario de invitar', async () => {
    montar({ lotes: [{ id: 7, evento: 'Wield 2', total_subido: 45 }], puedeInvitar: false });

    await screen.findByText('gasolina');
    expect(screen.queryByText(/Invite someone/)).toBeNull();
  });

  it('346. con permiso, invita a alguien a su proyecto y enseña el enlace; si el servidor dice que no, enseña por qué', async () => {
    montar({ lotes: [{ id: 7, evento: 'Wield 2', total_subido: 45 }], puedeInvitar: true }, {
      '/api/colaborador/invitaciones': opciones => (JSON.parse(opciones.body).usuario === 'mala@ejemplo.test'
        ? { __status: 403, error: 'Solo puedes invitar a tu propio proyecto.' } : { ok: true, enlace: 'https://app.test/invitacion/xyz' }),
    });
    const formulario = (await screen.findByText('Invite someone to Wield 2')).closest('.tarjeta');
    const dentro = within(formulario);

    fireEvent.change(dentro.getByPlaceholderText('Name'), { target: { value: 'Mala' } });
    fireEvent.change(dentro.getByPlaceholderText('Email'), { target: { value: 'mala@ejemplo.test' } });
    fireEvent.click(dentro.getByRole('button', { name: 'Invite' }));
    expect(await dentro.findByText('Solo puedes invitar a tu propio proyecto.')).toBeTruthy();

    fireEvent.change(dentro.getByPlaceholderText('Email'), { target: { value: 'buena@ejemplo.test' } });
    fireEvent.click(dentro.getByRole('button', { name: 'Invite' }));
    expect(await dentro.findByRole('link', { name: 'https://app.test/invitacion/xyz' })).toBeTruthy();
    const envios = llamadas('/api/colaborador/invitaciones').map(([, o]) => JSON.parse(o.body));
    expect(envios[1]).toEqual({ nombre: 'Mala', usuario: 'buena@ejemplo.test', proyectoId: 5 });
  });

  it('347. corregir o retirar una factura propia manda la petición con su número y recarga', async () => {
    montar({ lotes: [{ id: 7, evento: 'Wield 2', total_subido: 45 }] }, {
      '/api/colaborador/facturas/': { ok: true },
    });
    await screen.findByText('gasolina');

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    await waitFor(() => expect(llamadas('/api/colaborador/facturas/')).toHaveLength(1));
    expect(llamadas('/api/colaborador/facturas/')[0][1].method).toBe('DELETE');
  });
});
