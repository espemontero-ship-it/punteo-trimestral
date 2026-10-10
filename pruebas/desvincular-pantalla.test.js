import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { pintarMovimientos, unGrupo, unMovimiento, fetchDeMentira } from './ayuda-pantalla.js';

let red;
beforeEach(() => { red = fetchDeMentira(); });
afterEach(() => { vi.unstubAllGlobals(); });

const lineaConFactura = (cambios = {}, factura = {}) => unMovimiento({
  id: 901, concepto: 'COMPRA FERRETERIA', importe: -45, fecha: '2026-09-10', estado: 'resuelta', nota_final: 'material',
  facturas: [{ id: 46, numero: 46, cubre: 0, ...factura }], ...cambios,
});

function abrir(movimientos) {
  pintarMovimientos({ proveedores: [unGrupo(movimientos)] });
  fireEvent.click(screen.getByRole('checkbox'));
}

describe('desvincular una factura', () => {
  it('17. cada factura enlazada lleva su ✕, y al pulsarlo pide confirmación diciendo qué pasa con la línea', () => {
    abrir([lineaConFactura()]);

    fireEvent.click(screen.getByTitle('Desvincular factura'));

    expect(screen.getByText('¿Desvincular esta factura?')).toBeTruthy();
    expect(screen.getByText(/La factura 46 dejará de estar enlazada a la línea del .* de 45\.00€, que vuelve a quedar sin resolver/)).toBeTruthy();
    expect(red.hacia('/api/facturas/46/desvincular')).toHaveLength(0);
  });

  it('18. confirmar llama a la ruta con la factura y la línea, y cancelar no llama a nada', async () => {
    abrir([lineaConFactura()]);

    fireEvent.click(screen.getByTitle('Desvincular factura'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(red.hacia('/api/facturas/46/desvincular')).toHaveLength(0);

    fireEvent.click(screen.getByTitle('Desvincular factura'));
    fireEvent.click(screen.getByRole('button', { name: 'Desvincular' }));

    await waitFor(() => expect(red.hacia('/api/facturas/46/desvincular')).toHaveLength(1));
    expect(red.hacia('/api/facturas/46/desvincular')[0].metodo).toBe('POST');
    expect(red.hacia('/api/facturas/46/desvincular')[0].cuerpo).toEqual({ movimientoId: 901 });
  });

  it('19. si la factura cubre varios movimientos, el aviso dice cuántos se sueltan', () => {
    abrir([lineaConFactura({}, { cubre: 5 })]);

    fireEvent.click(screen.getByTitle('Desvincular factura'));

    expect(screen.getByText(/La factura 46 cubre 5 movimientos\. Al desvincularla, esos 5 movimientos vuelven a quedar sin resolver/)).toBeTruthy();
  });

  it('20. si la línea tiene dos facturas, el aviso dice que sigue resuelta con la otra', () => {
    abrir([lineaConFactura({ facturas: [{ id: 46, numero: 46, cubre: 0 }, { id: 47, numero: 47, cubre: 0 }] })]);

    fireEvent.click(screen.getAllByTitle('Desvincular factura')[0]);

    expect(screen.getByText(/La línea sigue resuelta con la otra factura \(47\)/)).toBeTruthy();
  });

  it('21. una línea sin factura no lleva la ✕', () => {
    abrir([unMovimiento({ concepto: 'SIN FACTURA', estado: 'resuelta' })]);

    expect(screen.queryByTitle('Desvincular factura')).toBeNull();
  });
});
