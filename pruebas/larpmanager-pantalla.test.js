import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { fetchDeMentira } from './ayuda-pantalla.js';
import PagosLarpManager from '../app/components/PagosLarpManager.js';
import ToastHost from '../app/components/ToastHost.js';

let red;
beforeEach(() => { localStorage.clear(); });
afterEach(() => { vi.unstubAllGlobals(); });

const pago = (cambios = {}) => ({
  id: 1, nombre_real: 'Zaphod Beeblebrox', evento: 'Wield #2', importe: '13.00', fecha: '2026-09-29T00:00:00.000Z', estado: 'pendiente',
  movimiento_id: null, movimiento_fecha: null, movimiento_importe: null, movimiento_concepto: null,
  motivo: 'no_esta', motivoTexto: 'No aparece en el banco', ...cambios,
});

const montar = (pagos, extra = {}, props = {}) => {
  red = fetchDeMentira({ '/api/larpmanager-sin-emparejar': { pagos }, ...extra });
  return render(<><ToastHost /><PagosLarpManager onAbrirSubida={() => {}} onCambio={() => {}} {...props} /></>);
};
const filas = () => screen.getAllByRole('row').filter(f => !f.className.includes('cabecera'));

describe('la pestaña de pagos de LarpManager', () => {
  it('360. enseña cada pago con su nombre, evento, importe, fecha y por qué está sin emparejar', async () => {
    montar([pago()]);

    expect(await screen.findByText('Zaphod Beeblebrox')).toBeTruthy();
    expect(screen.getByText('Wield #2')).toBeTruthy();
    expect(screen.getByText('13.00€')).toBeTruthy();
    expect(screen.getByText('No aparece en el banco')).toBeTruthy();
    expect(screen.getByText('1 sin emparejar')).toBeTruthy();
  });

  it('361. si no hay ninguno, dice que todos tienen su movimiento', async () => {
    montar([]);

    expect(await screen.findByText(/todos los pagos de LarpManager tienen su movimiento/)).toBeTruthy();
  });

  it('362. por defecto solo salen los pendientes; quitando "Solo pendientes" salen también los ya emparejados, con su línea', async () => {
    montar([
      pago({ id: 1, nombre_real: 'Pendiente Uno' }),
      pago({ id: 2, nombre_real: 'Ya Emparejado', estado: 'resuelta', movimiento_id: 9, movimiento_fecha: '2026-09-29T00:00:00.000Z', movimiento_importe: '13.00', movimiento_concepto: 'TRANSFERENCIAS EMPAREJADO', motivoTexto: 'Emparejado' }),
    ]);
    await screen.findByText('Pendiente Uno');

    expect(screen.queryByText('Ya Emparejado')).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Solo pendientes' }));

    expect(screen.getByText('Ya Emparejado')).toBeTruthy();
    expect(screen.getByText(/TRANSFERENCIAS EMPAREJADO/)).toBeTruthy();
    expect(screen.getByText('2 pagos · 1 con su movimiento')).toBeTruthy();
  });

  it('363. el buscador filtra por cualquier columna, y si no hay coincidencias lo dice', async () => {
    montar([pago({ id: 1, nombre_real: 'Zaphod Beeblebrox' }), pago({ id: 2, nombre_real: 'Trillian Astra', evento: 'Glitz' })]);
    await screen.findByText('Zaphod Beeblebrox');

    fireEvent.change(screen.getByPlaceholderText('Buscar en cualquier columna...'), { target: { value: 'glitz' } });
    expect(screen.queryByText('Zaphod Beeblebrox')).toBeNull();
    expect(screen.getByText('Trillian Astra')).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText('Buscar en cualquier columna...'), { target: { value: 'zzzz' } });
    expect(screen.getByText('Nada que coincida con este filtro.')).toBeTruthy();
  });

  it('364. pulsar el título de una columna ordena, otra vez al revés, y a la tercera vuelve al orden de antes', async () => {
    montar([pago({ id: 1, nombre_real: 'Bravo', importe: '30.00' }), pago({ id: 2, nombre_real: 'Alfa', importe: '10.00' }), pago({ id: 3, nombre_real: 'Charlie', importe: '20.00' })]);
    await screen.findByText('Bravo');
    const nombres = () => filas().map(f => within(f).getAllByRole('cell')[0].textContent);

    expect(nombres()).toEqual(['Bravo', 'Alfa', 'Charlie']);
    fireEvent.click(screen.getByText('Nombre'));
    expect(nombres()).toEqual(['Alfa', 'Bravo', 'Charlie']);
    fireEvent.click(screen.getByText(/^Nombre/));
    expect(nombres()).toEqual(['Charlie', 'Bravo', 'Alfa']);
    fireEvent.click(screen.getByText(/^Nombre/));
    expect(nombres()).toEqual(['Bravo', 'Alfa', 'Charlie']);
    fireEvent.click(screen.getByText('Importe'));
    expect(nombres()).toEqual(['Alfa', 'Charlie', 'Bravo']);
  });

  it('365. el botón de arriba abre la subida, y Recalcular vuelve a cargar los pagos', async () => {
    const onAbrirSubida = vi.fn();
    montar([pago()], {}, { onAbrirSubida });
    await screen.findByText('Zaphod Beeblebrox');

    fireEvent.click(screen.getByRole('button', { name: /Subir pagos de LarpManager/ }));
    expect(onAbrirSubida).toHaveBeenCalledTimes(1);

    const antes = red.hacia('/api/larpmanager-sin-emparejar').length;
    fireEvent.click(screen.getByRole('button', { name: 'Recalcular' }));
    await waitFor(() => expect(red.hacia('/api/larpmanager-sin-emparejar').length).toBe(antes + 1));
  });
});

describe('las sugerencias de línea del banco', () => {
  const conSugerencia = (dudosa = false) => pago({
    motivo: dudosa ? 'importe_no_cuadra' : 'sin_confirmar', motivoTexto: dudosa ? 'El importe no cuadra' : 'Ok',
    sugerencia: { movimientoId: 55, fecha: '2026-09-29T00:00:00.000Z', importe: 13, concepto: 'TRANSFERENCIAS BEEBLEBROX', dudosa },
  });

  it('366. la sugerencia enseña la fecha, el importe y el concepto de la línea; la dudosa se distingue', async () => {
    const { container, unmount } = montar([conSugerencia(false)]);
    await screen.findByText(/TRANSFERENCIAS BEEBLEBROX/);
    expect(container.querySelector('.sugerencia')).toBeTruthy();
    expect(container.querySelector('.sugerencia.dudosa')).toBeNull();
    unmount();

    const otra = montar([conSugerencia(true)]);
    await screen.findByText(/TRANSFERENCIAS BEEBLEBROX/);
    expect(otra.container.querySelector('.sugerencia.dudosa')).toBeTruthy();
  });

  it('367. pulsar la sugerencia vincula el pago con esa línea, avisa y recarga', async () => {
    const onCambio = vi.fn();
    montar([conSugerencia()], { '/api/larpmanager-pagos/1/vincular': { ok: true, aprendidas: 2 } }, { onCambio });
    fireEvent.click(await screen.findByText(/TRANSFERENCIAS BEEBLEBROX/));

    await waitFor(() => expect(red.hacia('/api/larpmanager-pagos/1/vincular')).toHaveLength(1));
    expect(red.hacia('/api/larpmanager-pagos/1/vincular')[0].cuerpo).toEqual({ movimientoId: 55 });
    expect(await screen.findByText('Vinculado')).toBeTruthy();
    expect(await screen.findByText(/Aprendido cómo lo llama el banco/)).toBeTruthy();
    await waitFor(() => expect(onCambio).toHaveBeenCalledTimes(1));
  });

  it('368. la ✕ rechaza esa sugerencia para ese pago, sin vincular nada', async () => {
    montar([conSugerencia()], { '/api/larpmanager-pagos/1/rechazar': { ok: true } });
    await screen.findByText(/TRANSFERENCIAS BEEBLEBROX/);

    fireEvent.click(screen.getByTitle('Descartar esta sugerencia'));

    await waitFor(() => expect(red.hacia('/api/larpmanager-pagos/1/rechazar')).toHaveLength(1));
    expect(red.hacia('/api/larpmanager-pagos/1/rechazar')[0].cuerpo).toEqual({ movimientoId: 55 });
    expect(red.hacia('/vincular')).toHaveLength(0);
  });
});

describe('cambiar el estado de un pago y vincularlo a mano', () => {
  it('369. el desplegable de estado manda el estado elegido; si ya tiene línea, no se puede cambiar', async () => {
    montar([pago({ id: 1 }), pago({ id: 2, nombre_real: 'Con Linea', estado: 'resuelta', movimiento_id: 9, movimiento_fecha: '2026-09-29', movimiento_importe: '13', movimiento_concepto: 'X' })], { '/api/larpmanager-pagos/1/estado': { estado: 'ignorada' } });
    await screen.findByText('Zaphod Beeblebrox');

    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'ignorada' } });
    await waitFor(() => expect(red.hacia('/api/larpmanager-pagos/1/estado')).toHaveLength(1));
    expect(red.hacia('/api/larpmanager-pagos/1/estado')[0].cuerpo).toEqual({ estado: 'ignorada' });

    fireEvent.click(screen.getByRole('checkbox', { name: 'Solo pendientes' }));
    const conLinea = screen.getAllByRole('combobox').find(s => s.value === 'resuelta');
    expect(conLinea.disabled).toBe(true);
  });

  it('370. "Vincular" abre el panel con su historial y los movimientos candidatos, y "Es esta" vincula esa línea', async () => {
    montar([pago()], {
      '/api/larpmanager-pagos/1/candidatos': {
        candidatos: [
          { id: 70, fecha: '2026-09-29', importe: 13, concepto: 'INGRESO ZAPHOD', estado: 'sin_resolver', suNombre: true, mismoImporte: true },
          { id: 71, fecha: '2026-08-01', importe: 99, concepto: 'INGRESO AJENO', estado: 'sin_resolver', suNombre: false, mismoImporte: false },
        ],
        historial: [{ id: 1, evento: 'Wield #2', importe: 13, fecha: '2026-09-29', nota: 'Sin emparejar', movimiento: null }],
      },
      '/api/larpmanager-pagos/1/vincular': { ok: true },
    });
    await screen.findByText('Zaphod Beeblebrox');

    fireEvent.click(screen.getByRole('button', { name: 'Vincular' }));
    expect(await screen.findByText('Sus pagos en LarpManager')).toBeTruthy();
    expect(screen.getByText('Sin emparejar')).toBeTruthy();
    expect(screen.getByText('INGRESO ZAPHOD')).toBeTruthy();
    expect(screen.queryByText('INGRESO AJENO')).toBeNull();
    expect(screen.getByText(/1 de 2 llevan su nombre o su importe/)).toBeTruthy();

    fireEvent.click(screen.getByText('Ver todas'));
    expect(screen.getByText('INGRESO AJENO')).toBeTruthy();

    fireEvent.click(screen.getAllByRole('button', { name: 'Es esta' })[0]);
    await waitFor(() => expect(red.hacia('/api/larpmanager-pagos/1/vincular')).toHaveLength(1));
    expect(red.hacia('/api/larpmanager-pagos/1/vincular')[0].cuerpo).toEqual({ movimientoId: 70 });
  });

  it('371. si ningún candidato lleva su nombre ni su importe, enseña todos y lo dice; Cancelar cierra el panel', async () => {
    montar([pago()], { '/api/larpmanager-pagos/1/candidatos': { candidatos: [{ id: 71, fecha: '2026-08-01', importe: 99, concepto: 'INGRESO AJENO', estado: 'sin_resolver', suNombre: false, mismoImporte: false }], historial: [] } });
    await screen.findByText('Zaphod Beeblebrox');

    fireEvent.click(screen.getByRole('button', { name: 'Vincular' }));

    expect(await screen.findByText(/Ninguna lleva su nombre ni su importe/)).toBeTruthy();
    expect(screen.getByText('INGRESO AJENO')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByText('Sus pagos en LarpManager')).toBeNull();
  });
});
