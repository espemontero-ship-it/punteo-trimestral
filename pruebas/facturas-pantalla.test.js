import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { pintarFacturasTrimestre, unaFacturaSuelta, fetchDeMentira } from './ayuda-pantalla.js';

let red;
beforeEach(() => {
  localStorage.clear();
  red = fetchDeMentira();
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('la lista de facturas sueltas se pinta', () => {
  it('7. se pinta con facturas reales, una fila por factura, sin que el montaje la rompa', async () => {
    const f1 = unaFacturaSuelta({ nombre_original: 'ferreteria.pdf' });
    const f2 = unaFacturaSuelta({ nombre_original: 'papeleria.pdf' });
    pintarFacturasTrimestre({ facturas: [f1, f2] });

    expect(screen.getByText('ferreteria.pdf')).toBeTruthy();
    expect(screen.getByText('papeleria.pdf')).toBeTruthy();
    await waitFor(() => expect(red.hacia('/api/movimientos-pendientes')).toHaveLength(1));
  });
});

describe('la sugerencia de combinar facturas', () => {
  function unaConCombo(cambios = {}) {
    return unaFacturaSuelta({
      id: 100, numero: 40, proveedor: 'Ferretería Uno', totales: [45],
      estado: 'sin_match',
      motivo_tipo: 'combo_sugerido',
      motivo_detalle: null,
      motivo_candidatos: {
        movimientoId: 501,
        otrasFacturas: [{ id: 101, numero: 25, monto: 6.05 }],
        lineaImporte: -51.05,
        lineaConcepto: 'PAGO PRUEBA',
        hoja: 'BBVA',
        clave: 'pago prueba',
      },
      ...cambios,
    });
  }

  it('8a. se ve el número y el importe de la otra factura, y aplicarla llama a confirmar', async () => {
    const f = unaConCombo();
    pintarFacturasTrimestre({ facturas: [f] });

    const boton = screen.getByRole('button', { name: /la factura 25 \(6\.05€\)/ });
    fireEvent.click(boton);

    await waitFor(() => expect(red.hacia('/api/movimientos/501/confirmar')).toHaveLength(1));
    expect(red.hacia('/api/movimientos/501/confirmar')[0].cuerpo.facturaIds.sort()).toEqual([100, 101].sort());
  });

  it('8b. la ✕ la rechaza guardándola, con el tipo combo y los ids de las dos facturas', async () => {
    const f = unaConCombo();
    pintarFacturasTrimestre({ facturas: [f] });

    fireEvent.click(screen.getByTitle('Descartar esta sugerencia'));

    await waitFor(() => expect(red.hacia('/api/sugerencias/rechazar')).toHaveLength(1));
    expect(red.hacia('/api/sugerencias/rechazar')[0].cuerpo).toMatchObject({
      hoja: 'BBVA', clave: 'pago prueba', tipo: 'combo', valor: '100,101',
    });
  });
});

describe('vincular una factura a mano', () => {
  it('9. el botón Buscar llama a la ruta de datos con el importe, la fecha y el concepto', async () => {
    const f = unaFacturaSuelta({ totales: [45], fechas: ['2026-07-20'], concepto: 'gasolina' });
    pintarFacturasTrimestre({ facturas: [f] });

    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));

    await waitFor(() => expect(red.hacia(`/api/facturas/${f.id}/datos`)).toHaveLength(1));
    expect(red.hacia(`/api/facturas/${f.id}/datos`)[0].cuerpo).toMatchObject({
      importe: 45, fecha: '2026-07-20', concepto: 'gasolina',
    });
  });

  it('10. elegir un candidato ambiguo confirma con el movimiento correcto', async () => {
    const f = unaFacturaSuelta({
      estado: 'sin_match',
      motivo_tipo: 'ambiguo',
      motivo_detalle: null,
      motivo_candidatos: {
        candidatos: [{ movimientoId: 777, concepto: 'PAGO A', importe: -45, fecha: '2026-07-19', hoja: 'BBVA', clave: 'pago a' }],
      },
    });
    pintarFacturasTrimestre({ facturas: [f] });

    fireEvent.click(screen.getByText('PAGO A'));

    await waitFor(() => expect(red.hacia('/api/movimientos/777/confirmar')).toHaveLength(1));
    expect(red.hacia('/api/movimientos/777/confirmar')[0].cuerpo).toMatchObject({ facturaIds: [f.id] });
  });
});

describe('borrar facturas seleccionadas', () => {
  it('11. seleccionar todas y borrar llama al DELETE con los ids correctos', async () => {
    const f1 = unaFacturaSuelta();
    const f2 = unaFacturaSuelta();
    pintarFacturasTrimestre({ facturas: [f1, f2] });

    fireEvent.click(screen.getAllByRole('checkbox')[1]);
    fireEvent.click(screen.getByRole('button', { name: /Borrar seleccionadas \(2\)/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Borrar' }));

    await waitFor(() => expect(red.hacia('/api/facturas')).toHaveLength(1));
    const llamada = red.hacia('/api/facturas')[0];
    expect(llamada.metodo).toBe('DELETE');
    expect(llamada.cuerpo.ids.sort()).toEqual([f1.id, f2.id].sort());
  });
});

describe('la factura que cubre varios movimientos', () => {
  const unaQueCubre = () => unaFacturaSuelta({
    id: 46, numero: 46, proveedor: 'Bolt Operations', totales: [30], concepto: 'viajes',
    estado: 'revisar', motivo_tipo: 'cubre_varios',
    motivo_candidatos: {
      movimientoIds: [801, 802, 803], hoja: 'BBVA', clave: 'bolt',
      movimientosDatos: [
        { id: 801, fecha: '2026-09-14T00:00:00.000Z', importe: '-10.00' },
        { id: 802, fecha: '2026-09-15T00:00:00.000Z', importe: '-10.00' },
        { id: 803, fecha: '2026-09-16T00:00:00.000Z', importe: '-10.00' },
      ],
    },
  });

  it('12. se ve qué movimientos cubre, y aceptarla los enlaza todos a la vez', async () => {
    pintarFacturasTrimestre({ facturas: [unaQueCubre()] });

    const boton = screen.getByRole('button', { name: /cubre 3 movimientos que suman 30.00€/ });
    expect(boton.textContent).toContain('14/9 10.00€ · 15/9 10.00€ · 16/9 10.00€');
    fireEvent.click(boton);

    await waitFor(() => expect(red.hacia('/api/facturas/46/cubrir')).toHaveLength(1));
    expect(red.hacia('/api/facturas/46/cubrir')[0].cuerpo).toEqual({ movimientoIds: [801, 802, 803], nota: 'viajes' });
  });

  it('13. la ✕ la rechaza guardándola, con el tipo cubre', async () => {
    pintarFacturasTrimestre({ facturas: [unaQueCubre()] });

    fireEvent.click(screen.getByTitle('Descartar esta sugerencia'));

    await waitFor(() => expect(red.hacia('/api/sugerencias/rechazar')).toHaveLength(1));
    expect(red.hacia('/api/sugerencias/rechazar')[0].cuerpo).toMatchObject({
      hoja: 'BBVA', clave: 'bolt', tipo: 'cubre', valor: '46>801,802,803',
    });
  });

  it('14. ya enlazada, la columna Movimiento dice cuántos cubre y lo que suman', () => {
    const f = unaFacturaSuelta({
      id: 46, estado: 'matcheada', totales: [57.51],
      movimientos_cubiertos: '5', movimientos_suma: '57.51', movimiento_id: 801,
      movimiento_fecha: '2026-09-14T00:00:00.000Z', movimiento_concepto: 'COMPRA EN BOLT', movimiento_importe: '-8.50',
    });
    pintarFacturasTrimestre({ facturas: [f] });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Solo pendientes' }));

    expect(screen.getByText('5 movimientos · 57.51€')).toBeTruthy();
  });
});

describe('recalcular las sugerencias', () => {
  it('15. el botón llama a la ruta de recalcular y recarga la lista al terminar', async () => {
    red = fetchDeMentira({ '/api/facturas/recalcular': { ok: true, revisadas: 3 } });
    const { props } = pintarFacturasTrimestre({ facturas: [unaFacturaSuelta()] });

    fireEvent.click(screen.getByRole('button', { name: 'Recalcular sugerencias' }));

    await waitFor(() => expect(red.hacia('/api/facturas/recalcular')).toHaveLength(1));
    expect(red.hacia('/api/facturas/recalcular')[0].metodo).toBe('POST');
    await waitFor(() => expect(props.onCambio).toHaveBeenCalledTimes(1));
  });

  it('15b. mientras recalcula el botón no se puede volver a pulsar', async () => {
    let terminar;
    vi.stubGlobal('fetch', vi.fn(url => (String(url).includes('/api/facturas/recalcular')
      ? new Promise(resolver => { terminar = () => resolver({ ok: true, status: 200, json: async () => ({ ok: true, revisadas: 1 }) }); })
      : Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) }))));
    pintarFacturasTrimestre({ facturas: [unaFacturaSuelta()] });

    fireEvent.click(screen.getByRole('button', { name: 'Recalcular sugerencias' }));

    const boton = await screen.findByRole('button', { name: 'Recalculando...' });
    expect(boton.disabled).toBe(true);
    terminar();
    await screen.findByRole('button', { name: 'Recalcular sugerencias' });
  });
});

describe('una sugerencia que ya no está viva no deja nada escrito', () => {
  const sinSugerencia = tipo => unaFacturaSuelta({
    estado: tipo === 'sin_match' ? 'sin_match' : 'revisar', motivo_tipo: tipo, motivo_detalle: null, motivo_candidatos: null,
  });

  it('16. combo, ambiguo y varios movimientos rechazados no dejan su título en la celda Motivo', () => {
    pintarFacturasTrimestre({
      facturas: [sinSugerencia('combo_sugerido'), sinSugerencia('ambiguo'), sinSugerencia('cubre_varios')],
    });

    expect(screen.queryByText('Combinación de facturas sugerida')).toBeNull();
    expect(screen.queryByText('Varias líneas con el mismo importe')).toBeNull();
    expect(screen.queryByText('Posible factura de varios movimientos')).toBeNull();
  });

  it('16b. lo que no es una sugerencia sigue diciendo por qué no está emparejada', () => {
    pintarFacturasTrimestre({ facturas: [sinSugerencia('sin_match')] });

    expect(screen.getByText('Importe no coincide con ninguna línea')).toBeTruthy();
  });
});
