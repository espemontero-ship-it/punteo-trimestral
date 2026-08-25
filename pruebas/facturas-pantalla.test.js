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
