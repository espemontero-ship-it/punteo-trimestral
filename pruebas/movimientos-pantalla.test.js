import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { pintarMovimientos, unGrupo, unMovimiento, fetchDeMentira } from './ayuda-pantalla.js';

const COLUMNAS = ['Fecha', 'Concepto', 'Banco', 'Proveedor', 'Importe', 'Estado', 'Factura', 'Nota', 'Proyecto'];

let red;
beforeEach(() => { red = fetchDeMentira(); });
afterEach(() => { vi.unstubAllGlobals(); });

function filasDeMovimiento() {
  return screen.getAllByRole('row').filter(f => !f.className.includes('cabecera') && !f.className.includes('fila-grupo'));
}

describe('la tabla de movimientos se pinta', () => {
  it('6. se monta con datos realistas y saca una fila por movimiento', () => {
    const movimientos = [
      unMovimiento({ concepto: 'COMPRA FERRETERIA', importe: -45 }),
      unMovimiento({ concepto: 'COMPRA PAPELERIA', importe: -12.3 }),
    ];
    pintarMovimientos({ proveedores: [unGrupo(movimientos)] });

    expect(screen.getByRole('table')).toBeTruthy();
    expect(screen.getByText('COMPRA FERRETERIA')).toBeTruthy();
    expect(screen.getByText('COMPRA PAPELERIA')).toBeTruthy();
    expect(filasDeMovimiento()).toHaveLength(2);
    expect(screen.getByText('-45.00€')).toBeTruthy();
    expect(screen.getByText('-12.30€')).toBeTruthy();
  });

  it('7. un grupo de varias líneas saca su fila de grupo; uno de una sola, no', () => {
    const { unmount } = pintarMovimientos({
      proveedores: [unGrupo([unMovimiento(), unMovimiento()], { clave: 'amazon', proveedor: 'Amazon' })],
    });
    expect(document.querySelectorAll('.fila-grupo')).toHaveLength(1);
    unmount();

    pintarMovimientos({ proveedores: [unGrupo([unMovimiento()])] });
    expect(document.querySelectorAll('.fila-grupo')).toHaveLength(0);
  });
});

describe('el bloque de LarpManager', () => {
  const unIngreso = cambios => unMovimiento({
    concepto: 'TRANSFERENCIA RECIBIDA',
    importe: 45,
    datos_originales: { larpmanager: null },
    ...cambios,
  });

  it('1. una línea con un pago de LarpManager enganchado enseña el nombre del jugador', () => {
    const m = unIngreso({ datos_originales: { larpmanager: 'Pepito Pérez' } });
    pintarMovimientos({ proveedores: [unGrupo([m])] });

    expect(screen.getByText('Pepito Pérez')).toBeTruthy();
  });

  it('2. pulsar Vincular pide los candidatos y abre el panel', async () => {
    red = fetchDeMentira({ 'larpmanager-candidatos': { candidatos: [] } });
    const m = unIngreso();
    pintarMovimientos({ proveedores: [unGrupo([m])] });

    fireEvent.click(screen.getByRole('button', { name: 'Vincular' }));

    await waitFor(() => expect(red.hacia('larpmanager-candidatos')).toHaveLength(1));
    expect(red.hacia(`/api/movimientos/${m.id}/larpmanager-candidatos`)).toHaveLength(1);
    expect(await screen.findByText('Qué pago de LarpManager es este ingreso')).toBeTruthy();
  });

  it('3. elegir un candidato lo vincula por su pago', async () => {
    const candidato = {
      id: 77, nombreReal: 'Pepito Pérez', evento: 'Glitz',
      importe: 45, fecha: null, estado: 'pendiente', enlazado: null,
    };
    red = fetchDeMentira({ 'larpmanager-candidatos': { candidatos: [candidato] } });
    const m = unIngreso();
    pintarMovimientos({ proveedores: [unGrupo([m])] });

    fireEvent.click(screen.getByRole('button', { name: 'Vincular' }));
    const boton = await screen.findByRole('button', { name: 'Es este' });
    fireEvent.click(boton);

    await waitFor(() => expect(red.hacia('/api/larpmanager-pagos/77/vincular')).toHaveLength(1));
    expect(red.hacia('/api/larpmanager-pagos/77/vincular')[0].metodo).toBe('POST');
    expect(red.hacia('/api/larpmanager-pagos/77/vincular')[0].cuerpo).toMatchObject({ movimientoId: m.id });
  });

  it('4. quitar el vínculo pide confirmación, y al confirmar lo desvincula', async () => {
    const m = unIngreso({
      pagos_larpmanager: [{ id: 88, nombre: 'Pepito Pérez', evento: 'Glitz', importe: 45 }],
    });
    pintarMovimientos({ proveedores: [unGrupo([m])] });

    fireEvent.click(screen.getByTitle('Quitar el vínculo con Pepito Pérez'));

    expect(screen.getByText('¿Quitar este vínculo?')).toBeTruthy();
    expect(red.llamadas).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Quitar' }));

    await waitFor(() => expect(red.hacia('/api/larpmanager-pagos/88/desvincular')).toHaveLength(1));
  });
});

describe('la fontanería de la tabla', () => {
  it('5. la cabecera saca una columna por campo, en su orden', () => {
    pintarMovimientos();

    const cabeceras = screen.getAllByRole('columnheader');
    const nombres = cabeceras.map(c => c.textContent.replace(/[▲▼]/g, '').trim());
    for (const col of COLUMNAS) expect(nombres).toContain(col);
    expect(nombres.slice(0, COLUMNAS.length)).toEqual(COLUMNAS);
  });

  it('5b. cada cabecera lleva su agarradera para cambiar el ancho', () => {
    pintarMovimientos();
    const agarraderas = document.querySelectorAll('.resize-handle');
    expect(agarraderas.length).toBe(screen.getAllByRole('columnheader').length);
  });
});

describe('las sugerencias', () => {
  it('8. la sugerencia de proveedor se ve, y la ✕ la rechaza guardándola', async () => {
    const m = unMovimiento({ proveedor: null, proveedor_sugerido: 'Amazon' });
    pintarMovimientos({ proveedores: [unGrupo([m])] });

    expect(screen.getByText('Amazon')).toBeTruthy();

    fireEvent.click(screen.getByTitle('Descartar esta sugerencia'));

    await waitFor(() => expect(red.hacia('/api/sugerencias/rechazar')).toHaveLength(1));
    expect(red.hacia('/api/sugerencias/rechazar')[0].cuerpo).toMatchObject({
      hoja: m.hoja, clave: m.clave, tipo: 'proveedor', valor: 'Amazon',
    });
  });

  it('9. la sugerencia de facturas dice el proveedor y el importe de cada una, la suma y el concepto del banco', () => {
    const m = unMovimiento({
      concepto: 'TRANSFERENCIA A NOMBRE DE PRUEBA',
      importe: -127.05,
      combos_factura: [{
        facturaId: 1, numero: 101, concepto: null, proveedor: 'Ferretería Uno', importe: 101.95,
        detalle: null, exacto: false, diferencia: 0.95,
        otras: [
          { id: 2, numero: 25, monto: 6.05, proveedor: 'Papelería Dos' },
          { id: 3, numero: 10, monto: 20, proveedor: 'Bazar Tres' },
        ],
      }],
    });
    pintarMovimientos({ proveedores: [unGrupo([m])] });

    expect(screen.getByText('Banco: "TRANSFERENCIA A NOMBRE DE PRUEBA"')).toBeTruthy();

    const pastilla = screen.getByText(/facturas 101/);
    expect(pastilla.textContent).toContain('101 (101.95€, Ferretería Uno)');
    expect(pastilla.textContent).toContain('25 (6.05€, Papelería Dos)');
    expect(pastilla.textContent).toContain('10 (20.00€, Bazar Tres)');
    expect(pastilla.textContent).toContain('= 128.00€');
    expect(pastilla.textContent).toContain('NO CUADRA');
  });

  it('10. la sugerencia de pago a colaborador se ve, y aceptarla engancha el pago', async () => {
    const m = unMovimiento({
      pago_sugerido: { pagoId: 55, texto: 'pago a Ana — Glitz', exacto: true, diferencia: 0 },
    });
    pintarMovimientos({ proveedores: [unGrupo([m])] });

    fireEvent.click(screen.getByText('pago a Ana — Glitz'));

    await waitFor(() => expect(red.hacia(`/api/movimientos/${m.id}/vincular-pago`)).toHaveLength(1));
    expect(red.hacia(`/api/movimientos/${m.id}/vincular-pago`)[0].cuerpo).toMatchObject({ pagoId: 55 });
  });
});

describe('lo que se puede hacer en una fila', () => {
  it('11. cambiar el desplegable de Estado lo guarda', async () => {
    const m = unMovimiento();
    pintarMovimientos({ proveedores: [unGrupo([m])] });

    fireEvent.change(document.querySelector('.select-estado'), { target: { value: 'ignorar' } });

    await waitFor(() => expect(red.hacia(`/api/movimientos/${m.id}/estado`)).toHaveLength(1));
    expect(red.hacia(`/api/movimientos/${m.id}/estado`)[0].cuerpo).toMatchObject({ estado: 'ignorar' });
  });

  it('12. escribir una nota y darle a Enter la guarda', async () => {
    const m = unMovimiento();
    pintarMovimientos({ proveedores: [unGrupo([m])] });

    const campo = document.querySelector('.campo-nota');
    fireEvent.change(campo, { target: { value: 'material de atrezzo' } });
    fireEvent.keyDown(campo, { key: 'Enter' });

    await waitFor(() => expect(red.hacia(`/api/movimientos/${m.id}/confirmar`)).toHaveLength(1));
    expect(red.hacia(`/api/movimientos/${m.id}/confirmar`)[0].cuerpo).toMatchObject({ nota: 'material de atrezzo' });
  });
});

describe('los filtros', () => {
  it('13. "solo pendientes" esconde las resueltas, y al quitarlo vuelven', () => {
    const pendiente = unMovimiento({ concepto: 'SIGUE PENDIENTE' });
    const resuelta = unMovimiento({ concepto: 'YA RESUELTA', estado: 'resuelta' });
    pintarMovimientos({ proveedores: [unGrupo([pendiente, resuelta])] });

    expect(screen.getByText('SIGUE PENDIENTE')).toBeTruthy();
    expect(screen.queryByText('YA RESUELTA')).toBeNull();

    fireEvent.click(screen.getByRole('checkbox'));

    expect(screen.getByText('YA RESUELTA')).toBeTruthy();
  });

  it('14. el buscador filtra por texto de cualquier columna', () => {
    const uno = unMovimiento({ concepto: 'COMPRA FERRETERIA' });
    const otro = unMovimiento({ concepto: 'COMPRA PAPELERIA' });
    pintarMovimientos({ proveedores: [unGrupo([uno, otro])] });

    fireEvent.change(screen.getByPlaceholderText('Buscar en cualquier columna...'), {
      target: { value: 'papeleria' },
    });

    expect(screen.queryByText('COMPRA FERRETERIA')).toBeNull();
    expect(screen.getByText('COMPRA PAPELERIA')).toBeTruthy();
  });
});
