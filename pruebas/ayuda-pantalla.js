import { vi } from 'vitest';
import { render } from '@testing-library/react';
import TablaMovimientos from '../app/components/TablaMovimientos.js';
import TablaCuentas from '../app/components/TablaCuentas.js';
import FacturasTrimestre from '../app/components/FacturasTrimestre.js';

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

let siguienteFacturaId = 1;

export function unaFacturaDeLote(cambios = {}) {
  const id = cambios.id ?? siguienteFacturaId++;
  return {
    id,
    numero: id,
    nombre_original: `factura-${id}.pdf`,
    ruta_blob: `https://ejemplo/factura-${id}.pdf`,
    concepto: 'material',
    proveedor: 'Ferretería Uno',
    totales: [45],
    fechas: ['2026-07-20'],
    estado_revision: 'aceptada',
    motivo_rechazo: null,
    importe_a_mano: false,
    pago_id: null,
    es_imagen: false,
    creado_en: '2026-07-20T10:00:00.000Z',
    ...cambios,
  };
}

let siguientePagoId = 1;

export function unPago(cambios = {}) {
  const id = cambios.id ?? siguientePagoId++;
  return {
    id,
    importe: 45,
    fecha: '2026-07-21',
    es_efectivo: false,
    movimiento_id: null,
    movimiento_concepto: null,
    movimiento_hoja: null,
    facturas_numeros: [],
    ...cambios,
  };
}

export function pintarCuentas(cambios = {}) {
  const props = {
    lote: { colaborador_nombre: 'Ana de Prueba', evento: 'Glitz' },
    facturas: [unaFacturaDeLote()],
    pagos: [],
    totales: { totalAceptado: 45, totalPagado: 0, totalRechazado: 0, totalConciliado: 0, pendienteDePagar: 45 },
    soloLectura: false,
    cerrado: false,
    onGuardarFactura: vi.fn(),
    onSolicitarRechazo: vi.fn(),
    onSolicitarBorrado: vi.fn(),
    onCorregir: vi.fn(),
    onRetirar: vi.fn(),
    onCrearAnticipo: vi.fn(),
    onPagar: vi.fn(),
    ...cambios,
  };
  return { ...render(<TablaCuentas {...props} />), props };
}

let siguienteFacturaSueltaId = 1;

export function unaFacturaSuelta(cambios = {}) {
  const id = cambios.id ?? siguienteFacturaSueltaId++;
  return {
    id,
    numero: id,
    nombre_original: `factura-${id}.pdf`,
    proveedor_clave: null,
    estado: 'sin_match',
    es_imagen: false,
    importes: [45],
    totales: [45],
    fechas: ['2026-07-20'],
    concepto: 'material',
    creado_en: '2026-07-20T10:00:00.000Z',
    motivo_tipo: null,
    motivo_detalle: null,
    motivo_candidatos: null,
    proveedor: 'Ferretería Uno',
    huella: `huella-${id}`,
    subido_por_nombre: null,
    movimiento_id: null,
    movimiento_fecha: null,
    movimiento_concepto: null,
    movimiento_importe: null,
    ...cambios,
  };
}

export function pintarFacturasTrimestre(cambios = {}) {
  const props = {
    facturas: [unaFacturaSuelta()],
    onCambio: vi.fn(),
    ...cambios,
  };
  return { ...render(<FacturasTrimestre {...props} />), props };
}
