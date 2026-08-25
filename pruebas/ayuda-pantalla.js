import { vi } from 'vitest';
import { render } from '@testing-library/react';
import TablaMovimientos from '../app/components/TablaMovimientos.js';

let siguienteId = 1;

export function unMovimiento(cambios = {}) {
  const id = cambios.id ?? siguienteId++;
  return {
    id,
    hoja: 'BBVA',
    fila: id,
    fecha: '2026-07-20',
    concepto: 'COMPRA MATERIAL',
    importe: -45,
    clave: 'compra material',
    estado: 'sin_resolver',
    nota_final: null,
    datos_originales: null,
    larpmanager_candidatos: null,
    proyecto_id: null,
    proveedor: null,
    proyecto_nombre: null,
    es_devolucion: false,
    jugador_larpmanager: null,
    facturas: [],
    pagos_larpmanager: [],
    combos_factura: [],
    proyecto_sugerido: null,
    proveedor_sugerido: null,
    probable_devolucion: false,
    jugador_sugerido: null,
    pago_sugerido: null,
    ...cambios,
  };
}

export function unGrupo(movimientos, cambios = {}) {
  const lista = movimientos.length ? movimientos : [unMovimiento()];
  const primero = lista[0];
  const cuenta = estados => lista.filter(m => estados.includes(m.estado)).length;
  return {
    id: `${primero.hoja}::${primero.clave}`,
    hoja: primero.hoja,
    clave: primero.clave,
    proveedor: primero.proveedor || null,
    claves: [{ hoja: primero.hoja, clave: primero.clave }],
    movimientos: lista,
    categoria: 'nueva',
    subtipo: null,
    sugerenciaNota: '',
    detalle: null,
    total: lista.length,
    resueltas: cuenta(['resuelta']),
    pedidaPendiente: cuenta(['pedida_pendiente']),
    facturaFutura: cuenta(['factura_futura']),
    ignoradas: cuenta(['ignorada']),
    sinResolver: cuenta(['sin_resolver']),
    completo: lista.every(m => m.estado === 'resuelta'),
    ...cambios,
  };
}

export function fetchDeMentira(respuestaPorUrl = {}) {
  const llamadas = [];
  const falso = vi.fn(async (url, opciones = {}) => {
    let cuerpo = null;
    try { cuerpo = opciones.body ? JSON.parse(opciones.body) : null; } catch { cuerpo = opciones.body; }
    llamadas.push({ url, metodo: opciones.method || 'GET', cuerpo });

    const clave = Object.keys(respuestaPorUrl).find(k => String(url).includes(k));
    const datos = clave ? respuestaPorUrl[clave] : { ok: true };
    return { ok: true, status: 200, json: async () => datos };
  });
  vi.stubGlobal('fetch', falso);

  return {
    llamadas,
    hacia: fragmento => llamadas.filter(l => String(l.url).includes(fragmento)),
    ultima: () => llamadas[llamadas.length - 1],
  };
}

export function pintarMovimientos(cambios = {}) {
  const props = {
    proveedores: [unGrupo([unMovimiento()])],
    proyectos: [{ id: 1, nombre: 'Glitz' }, { id: 2, nombre: 'Wield 2' }],
    onCambio: vi.fn(),
    filtroLote: null,
    desde: '',
    hasta: '',
    onDesdeChange: vi.fn(),
    onHastaChange: vi.fn(),
    onRecalcular: vi.fn(),
    recalculando: false,
    pendientes: '1 pendiente',
    ...cambios,
  };
  return { ...render(<TablaMovimientos {...props} />), props };
}
