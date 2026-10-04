import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { pintarFacturasTrimestre, pintarMovimientos, unaFacturaSuelta, unGrupo, unMovimiento, fetchDeMentira } from './ayuda-pantalla.js';

let red;
beforeEach(() => { red = fetchDeMentira(); });
afterEach(() => { vi.unstubAllGlobals(); });

const emparejada = (cambios = {}) => unaFacturaSuelta({
  id: 46, numero: 46, estado: 'matcheada', totales: [45],
  movimiento_id: 901, movimiento_fecha: '2026-09-10T00:00:00.000Z', movimiento_concepto: 'COMPRA FERRETERIA', movimiento_importe: '-45.00',
  movimientos_cubiertos: '1', movimientos_suma: '45.00', ...cambios,
});

function abrirConEmparejadas(facturas) {
  pintarFacturasTrimestre({ facturas });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Solo pendientes' }));
}

describe('desvincular una factura desde la pestaña Facturas', () => {
  it('88. una factura emparejada lleva su ✎, y al pulsarlo pide confirmación diciendo qué pasa con la línea', () => {
    abrirConEmparejadas([emparejada()]);

    fireEvent.click(screen.getByTitle('Desvincular factura'));

    expect(screen.getByText('¿Desvincular esta factura?')).toBeTruthy();
    expect(screen.getByText(/La factura 46 dejará de estar enlazada a la línea del .* de 45\.00€\. Si esa línea no tiene otra factura, vuelve a quedar sin resolver/)).toBeTruthy();
    expect(red.hacia('/api/facturas/46/desvincular')).toHaveLength(0);
  });

  it('89. confirmar llama a la ruta con la factura y su línea, y recarga la lista', async () => {
    const { props } = pintarFacturasTrimestre({ facturas: [emparejada()] });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Solo pendientes' }));

    fireEvent.click(screen.getByTitle('Desvincular factura'));
    fireEvent.click(screen.getByRole('button', { name: 'Desvincular' }));

    await waitFor(() => expect(red.hacia('/api/facturas/46/desvincular')).toHaveLength(1));
    expect(red.hacia('/api/facturas/46/desvincular')[0].metodo).toBe('POST');
    expect(red.hacia('/api/facturas/46/desvincular')[0].cuerpo).toEqual({ movimientoId: 901 });
    await waitFor(() => expect(props.onCambio).toHaveBeenCalledTimes(1));
  });

  it('90. cancelar no llama a nada', () => {
    abrirConEmparejadas([emparejada()]);

    fireEvent.click(screen.getByTitle('Desvincular factura'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(red.hacia('/api/facturas/46/desvincular')).toHaveLength(0);
    expect(screen.queryByText('¿Desvincular esta factura?')).toBeNull();
  });

  it('91. si la factura cubre varios movimientos, el aviso dice cuántos se sueltan', () => {
    abrirConEmparejadas([emparejada({ movimientos_cubiertos: '5', movimientos_suma: '57.51' })]);

    fireEvent.click(screen.getByTitle('Desvincular factura'));

    expect(screen.getByText(/La factura 46 cubre 5 movimientos\. Al desvincularla, esos 5 movimientos vuelven a quedar sin resolver/)).toBeTruthy();
  });

  it('92. una factura sin emparejar no lleva el ✎', () => {
    pintarFacturasTrimestre({ facturas: [unaFacturaSuelta({ estado: 'sin_match' })] });

    expect(screen.queryByTitle('Desvincular factura')).toBeNull();
  });
});

describe('las líneas de Movimientos ya no llevan un botón Subir cada una', () => {
  it('93. una línea pendiente sin factura no tiene botón Subir', () => {
    pintarMovimientos({ proveedores: [unGrupo([unMovimiento({ concepto: 'PENDIENTE SIN FACTURA' })])] });

    expect(screen.getByText('PENDIENTE SIN FACTURA')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Subir' })).toBeNull();
  });
});
