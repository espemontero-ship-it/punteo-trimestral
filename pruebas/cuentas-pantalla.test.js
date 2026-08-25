import { describe, it, expect } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { pintarCuentas, unaFacturaDeLote, unPago } from './ayuda-pantalla.js';

describe('la tabla de cuentas se pinta', () => {
  it('1. se pinta con facturas, pagos y el total pendiente de pagar', () => {
    const f1 = unaFacturaDeLote({ concepto: 'gasolina', totales: [20] });
    const f2 = unaFacturaDeLote({ concepto: 'cinta americana', totales: [22.5] });
    const p1 = unPago({ facturas_numeros: [], importe: 20, es_efectivo: true });
    pintarCuentas({
      facturas: [f1, f2],
      pagos: [p1],
      totales: { totalAceptado: 45, totalPagado: 0, totalRechazado: 0, totalConciliado: 0, pendienteDePagar: 25 },
    });

    expect(screen.getByText('gasolina')).toBeTruthy();
    expect(screen.getByText('cinta americana')).toBeTruthy();
    expect(screen.getByText('Anticipo')).toBeTruthy();
    expect(screen.getByText('25.00€')).toBeTruthy();
  });
});

describe('pagar y anticipar (modo admin)', () => {
  it('2. el botón Pagar llama a onPagar con los ids de las facturas aceptadas', () => {
    const aceptada1 = unaFacturaDeLote({ estado_revision: 'aceptada' });
    const aceptada2 = unaFacturaDeLote({ estado_revision: 'aceptada' });
    const rechazada = unaFacturaDeLote({ estado_revision: 'rechazada' });
    const { props } = pintarCuentas({ facturas: [aceptada1, aceptada2, rechazada] });

    fireEvent.click(screen.getByRole('button', { name: 'Pagar' }));

    expect(props.onPagar).toHaveBeenCalledTimes(1);
    const argumento = props.onPagar.mock.calls[0][0];
    expect(argumento.facturaIds.sort()).toEqual([aceptada1.id, aceptada2.id].sort());
  });

  it('3. añadir un anticipo abre el modal, lo envía, y se cierra', async () => {
    const { props } = pintarCuentas();

    expect(screen.queryByText('Añadir anticipo')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '+ Añadir anticipo' }));
    expect(screen.getByText('Añadir anticipo')).toBeTruthy();

    const importe = screen.getByPlaceholderText('Ej. 50');
    fireEvent.change(importe, { target: { value: '30' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.submit(screen.getByRole('button', { name: 'Añadir' }).closest('form'));

    await waitFor(() => expect(props.onCrearAnticipo).toHaveBeenCalledTimes(1));
    expect(props.onCrearAnticipo.mock.calls[0][0]).toMatchObject({ importe: '30', esEfectivo: true });
    await waitFor(() => expect(screen.queryByText('Añadir anticipo')).toBeNull());
  });
});

describe('modo colaborador', () => {
  it('4. Corregir y Retirar llaman a sus props; no se ven los controles de admin', async () => {
    const f = unaFacturaDeLote({ estado_revision: 'aceptada' });
    const { props } = pintarCuentas({ soloLectura: true, facturas: [f] });

    expect(screen.queryByRole('button', { name: 'Pagar' })).toBeNull();
    expect(screen.queryByRole('button', { name: '+ Añadir anticipo' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(props.onCorregir).toHaveBeenCalledTimes(1));
    expect(props.onCorregir.mock.calls[0][0]).toBe(f.id);

    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    await waitFor(() => expect(props.onRetirar).toHaveBeenCalledTimes(1));
    expect(props.onRetirar.mock.calls[0][0]).toBe(f.id);
  });
});

describe('proyecto cerrado', () => {
  it('5a. en modo admin, cerrado esconde Pagar y el anticipo', () => {
    pintarCuentas({ cerrado: true });
    expect(screen.queryByRole('button', { name: 'Pagar' })).toBeNull();
    expect(screen.queryByRole('button', { name: '+ Añadir anticipo' })).toBeNull();
  });

  it('5b. en modo colaborador, cerrado esconde Corregir y Retirar', () => {
    const f = unaFacturaDeLote({ estado_revision: 'aceptada' });
    pintarCuentas({ soloLectura: true, cerrado: true, facturas: [f] });
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
  });
});

describe('privacidad del concepto del banco', () => {
  it('6. el colaborador ve "Pagada", el admin ve el concepto de la línea del banco', () => {
    const pago = unPago({
      facturas_numeros: [1],
      movimiento_id: 99,
      movimiento_concepto: 'TRANSFERENCIA A NOMBRE DE PRUEBA',
      es_efectivo: false,
    });

    const admin = pintarCuentas({ facturas: [], pagos: [pago] });
    expect(admin.container.textContent).toContain('TRANSFERENCIA A NOMBRE DE');
    admin.unmount();

    const colaborador = pintarCuentas({ soloLectura: true, facturas: [], pagos: [pago] });
    expect(colaborador.container.textContent).not.toContain('TRANSFERENCIA');
    expect(colaborador.container.textContent).toContain('Paid');
  });
});
