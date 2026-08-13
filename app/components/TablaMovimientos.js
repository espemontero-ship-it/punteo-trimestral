'use client';

import { useState, useMemo, Fragment } from 'react';
import { apiFetch, mostrarToast } from '../lib/toast';
import { useAnchosPersistidos } from '../lib/useAnchosPersistidos';
import SubirFactura from './SubirFactura';

const ETIQUETAS = {
  fija: 'fija',
  mixta: 'mixta',
  nueva: 'nueva',
};

const COLUMNAS_BASE = ['Grupo', 'Fecha', 'Concepto', 'Banco', 'Proveedor', 'Importe', 'Estado', 'Factura', 'Nota', 'Proyecto'];
const ANCHO_DEFECTO = { Grupo: 40, Fecha: 85, Concepto: 200, Banco: 85, Proveedor: 150, Importe: 80, Estado: 130, Factura: 90, Nota: 135, Proyecto: 110 };
const ANCHO_EXTRA_DEFECTO = 120;

// Celda vive fuera del componente a propósito: si se define dentro (como
// estaba antes), React la trata como un tipo de componente nuevo en cada
// render y desmonta/remonta todo lo de dentro -- incluidos los <input>, que
// pierden el foco en cada tecla. stickyLefts se pasa como prop en vez de
// leerlo de un cierre porque Celda ya no tiene acceso al estado del componente.
function claseCeldaTabla(col) {
  if (col === 'Grupo') return 'col-grupo';
  if (col === 'Fecha') return 'col-fecha';
  if (col === 'Concepto') return 'col-concepto';
  if (col === 'Importe') return 'col-importe';
  return '';
}

function estiloCeldaTabla(col, cabecera, stickyLefts) {
  if (stickyLefts && col in stickyLefts) {
    return { position: 'sticky', left: stickyLefts[col], zIndex: cabecera ? 4 : 3 };
  }
  return undefined;
}

function Celda({ col, className = '', cabecera, children, stickyLefts }) {
  return (
    <div
      role={cabecera ? 'columnheader' : 'cell'}
      className={`celda ${claseCeldaTabla(col)} ${className}`.trim()}
      style={estiloCeldaTabla(col, cabecera, stickyLefts)}
    >
      {children}
    </div>
  );
}

// Un movimiento separado de su grupo lleva su id como sufijo en la clave
// (ver lib/agrupador.cjs#separarDeGrupo) para que quede aparte pero el
// nombre en pantalla siga siendo el original.
function nombreGrupo(clave) {
  return (clave || '').replace(/ #\d+$/, '');
}

// La cabecera del grupo muestra el nombre corto de Proveedor si ya se ha
// puesto en alguna línea del grupo — si no, cae al texto de la clave (el
// mismo que se usaba antes de que existiera el campo Proveedor).
function nombreGrupoMostrado(g) {
  const conProveedor = g.movimientos.find(m => m.proveedor);
  return conProveedor ? conProveedor.proveedor : nombreGrupo(g.clave);
}

export default function TablaMovimientos({
  proveedores, proyectos, onCambio, filtroLote, onQuitarFiltro, onResolverImporteManual,
  desde, hasta, onDesdeChange, onHastaChange, onRecalcular, recalculando, pendientes,
}) {
  const [busqueda, setBusqueda] = useState('');
  const [soloPendientes, setSoloPendientes] = useState(true);
  const [ordenPor, setOrdenPor] = useState(null); // { campo, dir } | null (null = agrupado por proveedor)
  const [mostrarColumnas, setMostrarColumnas] = useState(false);
  const [mostrarFechas, setMostrarFechas] = useState(false);
  const [columnasExtraVisibles, setColumnasExtraVisibles] = useState(() => new Set(['larpmanager']));
  const [notasManual, setNotasManual] = useState({});
  const [proveedoresManual, setProveedoresManual] = useState({});
  const [notasGrupo, setNotasGrupo] = useState({});
  const [proveedoresGrupo, setProveedoresGrupo] = useState({});
  const [anchos, setAnchos] = useAnchosPersistidos('punteo-anchos-movimientos');
  const [importesManual, setImportesManual] = useState({});
  const [guardandoImporte, setGuardandoImporte] = useState(null);
  const [modoDevolucion, setModoDevolucion] = useState(new Set());
  const [jugadorManual, setJugadorManual] = useState({});
  const [grupoAbiertoPara, setGrupoAbiertoPara] = useState(null); // movimientoId | null -- "+" abierto en esa fila

  function anchoDe(col) {
    return anchos[col] ?? ANCHO_DEFECTO[col] ?? ANCHO_EXTRA_DEFECTO;
  }

  // Escucha en window (no en el propio tirador) para que el arrastre siga
  // funcionando aunque el cursor se salga de la franja de 12px durante el
  // movimiento. setPointerCapture se intenta como mejora, pero envuelto en
  // try/catch: puede lanzar una excepción en algunos navegadores/casos, y si
  // no se protege, esa excepción mata la función entera antes de que se
  // lleguen a registrar los listeners — eso hacía que el arrastre no
  // hiciera nada aunque el cursor sí cambiase (el cursor es solo CSS).
  function iniciarArrastre(e, col) {
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
    const startX = e.clientX;
    const startWidth = anchoDe(col);
    function mover(ev) {
      const nuevo = Math.max(50, startWidth + (ev.clientX - startX));
      setAnchos(prev => ({ ...prev, [col]: nuevo }));
    }
    function soltar() {
      window.removeEventListener('pointermove', mover);
      window.removeEventListener('pointerup', soltar);
    }
    window.addEventListener('pointermove', mover);
    window.addEventListener('pointerup', soltar);
  }

  const columnasExtra = useMemo(() => {
    const nombres = new Set();
    for (const g of proveedores) {
      for (const m of g.movimientos) {
        if (m.datos_originales) Object.keys(m.datos_originales).forEach(k => nombres.add(k));
      }
    }
    return [...nombres].sort();
  }, [proveedores]);

  async function subirFacturaDesdeFila(g, resultado) {
    mostrarToast(resultado.detalle, resultado.tipo === 'match_directo' ? 'ok' : 'error');
    onCambio();
  }

  const grupos = useMemo(() => {
    const texto = busqueda.trim().toLowerCase();
    return proveedores
      .map(g => ({
        ...g,
        importeTotal: g.movimientos.reduce((s, m) => s + Number(m.importe), 0),
        movimientos: g.movimientos.filter(m => {
          if (filtroLote) return filtroLote.ids.has(m.id);
          if (soloPendientes && ['resuelta', 'ignorada', 'factura_futura'].includes(m.estado)) return false;
          if (!texto) return true;
          const campos = [m.concepto, g.clave, g.hoja, m.nota_final, m.importe, m.fecha, ...(m.datos_originales ? Object.values(m.datos_originales) : [])];
          return campos.some(v => v !== null && v !== undefined && String(v).toLowerCase().includes(texto));
        }),
      }))
      .filter(g => g.movimientos.length > 0);
  }, [proveedores, busqueda, soloPendientes, filtroLote]);

  const filasOrdenadas = useMemo(() => {
    if (!ordenPor) return null;
    const todas = grupos.flatMap(g => g.movimientos.map(m => ({ m, g })));
    const factor = ordenPor.dir === 'desc' ? -1 : 1;
    return todas.sort((a, b) => {
      const va = valorOrden(a, ordenPor.campo);
      const vb = valorOrden(b, ordenPor.campo);
      if (va < vb) return -1 * factor;
      if (va > vb) return 1 * factor;
      return 0;
    });
  }, [grupos, ordenPor]);

  function valorOrden({ m, g }, campo) {
    switch (campo) {
      case 'Fecha': return m.fecha || '';
      case 'Concepto': return m.concepto || '';
      case 'Banco': return g.hoja || '';
      case 'Proveedor': return g.clave || '';
      case 'Importe': return Number(m.importe);
      case 'Estado': return m.estado || '';
      case 'Nota': return m.nota_final || '';
      case 'Proyecto': return m.proyecto_nombre || '';
      default: return m.datos_originales?.[campo] ?? '';
    }
  }

  function alternarOrden(campo) {
    setOrdenPor(prev => {
      if (!prev || prev.campo !== campo) return { campo, dir: 'asc' };
      if (prev.dir === 'asc') return { campo, dir: 'desc' };
      return null;
    });
  }

  function alternarColumnaExtra(nombre) {
    setColumnasExtraVisibles(prev => {
      const next = new Set(prev);
      if (next.has(nombre)) next.delete(nombre); else next.add(nombre);
      return next;
    });
  }

  async function confirmarNota(movimientoId, valor) {
    const nota = (valor ?? '').trim();
    const r = await apiFetch(`/api/movimientos/${movimientoId}/confirmar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nota }),
    }, { mensajeOk: 'Guardado', mensajeError: 'No se pudo guardar.' });
    if (r) onCambio();
  }

  async function cambiarEstado(m, nuevoEstado) {
    // "devolución" no es un estado que se guarde tal cual (ver
    // lib/devoluciones.cjs) -- elegirlo en el desplegable solo abre el campo
    // de jugador en la celda de Proveedor; el guardado real (que deja la
    // línea en "resuelta") pasa por confirmarDevolucion. Al no tocar m.estado
    // aquí, el desplegable (controlado por valorEstadoSelect) vuelve solo a
    // mostrar el valor real en cuanto se re-renderiza.
    if (nuevoEstado === 'devolucion') {
      alternarModoDevolucion(m);
      return;
    }
    if (nuevoEstado === 'resuelta') {
      // La nota es opcional: se guarda si hay algo escrito, pero no bloquea marcar como resuelta.
      const nota = (notasManual[m.id] ?? m.nota_final ?? '').trim();
      const r = await apiFetch(`/api/movimientos/${m.id}/confirmar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nota }),
      }, { mensajeOk: 'Guardado', mensajeError: 'No se pudo guardar.' });
      if (r) onCambio();
      return;
    }
    const r = await apiFetch(`/api/movimientos/${m.id}/estado`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ estado: nuevoEstado }),
    }, { mensajeError: 'No se pudo cambiar el estado.' });
    if (r) onCambio();
  }

  async function confirmarNotaGrupo(g, nota) {
    const limpia = (nota ?? '').trim();
    const r = await apiFetch(`/api/proveedores/confirmar-grupo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hoja: g.hoja, clave: g.clave, nota: limpia }),
    }, { mensajeOk: `${g.total - g.resueltas} línea(s) confirmadas`, mensajeError: 'No se pudo confirmar el grupo.' });
    if (r) onCambio();
  }

  async function cambiarEstadoGrupo(g, nuevoEstado) {
    if (nuevoEstado === 'resuelta') {
      // La nota es opcional: se guarda si hay algo escrito, pero no bloquea marcar el grupo como resuelto.
      const nota = (notasGrupo[g.id] ?? '').trim();
      const r = await apiFetch(`/api/proveedores/confirmar-grupo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hoja: g.hoja, clave: g.clave, nota }),
      }, { mensajeOk: `${g.total - g.resueltas} línea(s) confirmadas`, mensajeError: 'No se pudo confirmar el grupo.' });
      if (r) onCambio();
      return;
    }
    if (nuevoEstado === 'pedida') {
      const r = await apiFetch(`/api/proveedores/pendiente`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hoja: g.hoja, clave: g.clave }),
      }, { mensajeOk: 'Marcadas como pedida, esperando al proveedor', mensajeError: 'No se pudo marcar.' });
      if (r) onCambio();
    }
  }

  async function guardarProveedor(movimientoId, valor) {
    const r = await apiFetch(`/api/movimientos/${movimientoId}/proveedor`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ proveedor: (valor ?? '').trim() }),
    }, { mensajeOk: 'Guardado', mensajeError: 'No se pudo guardar.' });
    if (r) onCambio();
  }

  // Alternativa a Proveedor: en vez de un gasto, la línea es una devolución
  // a un jugador de LarpManager. Se entra en "modo edición" para poder
  // revisar/corregir el nombre sugerido antes de confirmar -- nunca se marca
  // sola, ni con la sugerencia automática por texto.
  function alternarModoDevolucion(m) {
    setModoDevolucion(prev => {
      const next = new Set(prev);
      if (next.has(m.id)) {
        next.delete(m.id);
      } else {
        next.add(m.id);
        setJugadorManual(prevJ => (prevJ[m.id] !== undefined ? prevJ : { ...prevJ, [m.id]: m.jugador_sugerido || '' }));
      }
      return next;
    });
  }

  async function confirmarDevolucion(m) {
    const jugador = (jugadorManual[m.id] ?? '').trim();
    const r = await apiFetch(`/api/movimientos/${m.id}/devolucion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jugador }),
    }, { mensajeOk: 'Marcada como devolución', mensajeError: 'No se pudo guardar.' });
    if (r) {
      setModoDevolucion(prev => { const next = new Set(prev); next.delete(m.id); return next; });
      onCambio();
    }
  }

  async function guardarProveedorGrupo(g, valor) {
    const r = await apiFetch(`/api/proveedores/proveedor-grupo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hoja: g.hoja, clave: g.clave, proveedor: (valor ?? '').trim() }),
    }, { mensajeOk: 'Guardado', mensajeError: 'No se pudo guardar.' });
    if (r) onCambio();
  }

  async function elegirCandidato(opcion) {
    const nota = opcion.esCombo ? [opcion.numero, ...opcion.otrasFacturas.map(o => o.numero)].join(' + ') : (opcion.facturaConcepto || String(opcion.numero));
    const facturaIds = opcion.esCombo ? [opcion.facturaId, ...opcion.otrasFacturas.map(o => o.id)] : [opcion.facturaId];
    const r = await apiFetch(`/api/movimientos/${opcion.movimientoId}/confirmar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nota, facturaIds }),
    }, { mensajeOk: 'Guardado', mensajeError: 'No se pudo guardar.' });
    if (r) onCambio();
  }

  // A propósito NO escribe nada en la Nota -- son dos conceptos distintos:
  // la Nota es la referencia que se manda a gestoría, la columna larpmanager
  // es solo la comprobación de que el pago llegó. Si LarpManager ya sabe de
  // qué evento es (ej. "Wield #2"), se aprovecha para sugerir proyecto igual
  // que ya hace el resto de la app por texto de concepto. Un único endpoint
  // (no dos fetches sueltos) para que también quede marcado en
  // larpmanager_pagos que este pago concreto ya encontró su línea del
  // banco -- si no, "ver pagos sin emparejar" seguiría listándolo.
  async function resolverConLarpManager(m, candidato) {
    const r = await apiFetch(`/api/movimientos/${m.id}/resolver-larpmanager`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(candidato),
    }, { mensajeOk: 'Marcado', mensajeError: 'No se pudo marcar.' });
    if (r) onCambio();
  }

  async function guardarImporteManual(f) {
    const valor = (importesManual[f.facturaId] || '').replace(',', '.').trim();
    const importe = Number(valor);
    if (!valor || isNaN(importe) || importe <= 0) return;
    setGuardandoImporte(f.facturaId);
    await onResolverImporteManual(f.facturaId, f.nombreArchivo, importe);
    setGuardandoImporte(null);
  }

  async function separarDeGrupo(movimientoId) {
    const r = await apiFetch(`/api/movimientos/${movimientoId}/separar`, {
      method: 'POST',
    }, { mensajeOk: 'Sacado del grupo', mensajeError: 'No se pudo sacar del grupo.' });
    if (r) onCambio();
  }

  async function unirAGrupo(movimientoId, grupoDestino) {
    setGrupoAbiertoPara(null);
    const r = await apiFetch(`/api/movimientos/${movimientoId}/unir`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hoja: grupoDestino.hoja, clave: grupoDestino.clave }),
    }, { mensajeOk: 'Unido al grupo', mensajeError: 'No se pudo unir al grupo.' });
    if (r) onCambio();
  }

  // Grupos reales (>1 línea) por banco, para ofrecer como destino al pulsar
  // "+" -- solo del mismo banco que la línea que se quiere unir.
  const gruposPorHoja = useMemo(() => {
    const mapa = {};
    for (const g of proveedores) {
      if (g.total <= 1) continue;
      (mapa[g.hoja] ||= []).push({ hoja: g.hoja, clave: g.clave, nombre: nombreGrupoMostrado(g) });
    }
    return mapa;
  }, [proveedores]);

  async function asignarProyecto(movimientoId, proyectoId) {
    const r = await apiFetch(`/api/movimientos/${movimientoId}/proyecto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ proyectoId: proyectoId || null }),
    }, { mensajeError: 'No se pudo guardar el proyecto.' });
    if (r) onCambio();
  }

  async function asignarProyectoGrupo(g, proyectoId) {
    const r = await apiFetch(`/api/proveedores/proyecto-grupo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hoja: g.hoja, clave: g.clave, proyectoId: proyectoId || null }),
    }, { mensajeError: 'No se pudo guardar el proyecto.' });
    if (r) onCambio();
  }

  const columnasVisiblesExtra = columnasExtra.filter(c => columnasExtraVisibles.has(c));
  const columnasTodas = [...COLUMNAS_BASE, ...columnasVisiblesExtra];
  // Única fuente de verdad para el ancho de columnas: la misma plantilla se
  // aplica a la cabecera y a cada fila via grid-template-columns, así que es
  // estructuralmente imposible que una fila quede desalineada de otra (antes,
  // con <table>, el ancho se repartía entre colgroup + estilo del <th> + una
  // variable CSS aparte para las columnas fijas, y esos tres sitios podían
  // desincronizarse).
  const plantillaColumnas = columnasTodas.map(c => `${anchoDe(c)}px`).join(' ');
  // Grupo, Fecha y Concepto se quedan fijas al hacer scroll horizontal --
  // cada una necesita su propio left, calculado a partir de los anchos de
  // las que van antes (misma fuente de verdad que la plantilla de arriba).
  const anchoGrupo = anchoDe('Grupo');
  const anchoFecha = anchoDe('Fecha');
  const stickyLefts = { Grupo: 0, Fecha: anchoGrupo, Concepto: anchoGrupo + anchoFecha };

  function valorEstadoSelect(m) {
    if (m.estado === 'resuelta') return 'resuelta';
    if (m.estado === 'pedida_pendiente') return 'pedida';
    if (m.estado === 'factura_futura') return 'factura_futura';
    if (m.estado === 'ignorada') return 'ignorar';
    return 'pendiente';
  }

  // Devolución vive aquí, no en Proveedor: una devolución no tiene proveedor,
  // el jugador es la referencia que de verdad se manda a gestoría (igual que
  // la Nota de cualquier otra línea), así que comparten celda.
  function celdaNota(m, g) {
    if (m.es_devolucion) {
      return (
        <>
          <span>Devolución — {m.jugador_larpmanager || <span className="vacio">sin jugador</span>}</span>
          <button type="button" className="btn-editar-mini" title="Editar devolución" onClick={() => alternarModoDevolucion(m)}>✎</button>
        </>
      );
    }
    if (modoDevolucion.has(m.id)) {
      return (
        <div>
          <input
            className="campo-proveedor"
            type="text"
            placeholder="Jugador en LarpManager..."
            value={jugadorManual[m.id] ?? ''}
            onChange={e => setJugadorManual(prev => ({ ...prev, [m.id]: e.target.value }))}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); confirmarDevolucion(m); } }}
          />
          <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
            <button type="button" className="secundario" style={{ fontSize: 11, padding: '4px 8px' }} onClick={() => confirmarDevolucion(m)}>
              Confirmar devolución
            </button>
            <button type="button" className="secundario" style={{ fontSize: 11, padding: '4px 8px' }} onClick={() => alternarModoDevolucion(m)}>
              Cancelar
            </button>
          </div>
        </div>
      );
    }
    const resuelta = m.estado === 'resuelta';
    if (resuelta) return <span className="nota-texto">{m.nota_final}</span>;
    const opcionesLote = filtroLote?.ambiguos?.[m.id];
    if (opcionesLote?.length) {
      return (
        <div className="opciones-lote">
          {opcionesLote.map((o, i) => (
            <button key={i} type="button" className="chip-sugerencia" style={{ display: 'block', marginTop: 4 }} onClick={() => elegirCandidato(o)}>
              {o.esCombo ? `Aplicar: combinar con factura${o.otrasFacturas.length > 1 ? 's' : ''} ${o.otrasFacturas.map(x => x.numero).join(' + ')}` : `Aplicar: factura ${o.numero}${o.facturaConcepto ? ` (${o.facturaConcepto})` : ''}`}
            </button>
          ))}
        </div>
      );
    }
    const sugerencia = g.sugerenciaNota;
    const valorActual = notasManual[m.id] ?? (sugerencia || '');
    return (
      <input
        className="campo-nota"
        type="text"
        placeholder=""
        value={valorActual}
        onChange={e => setNotasManual(prev => ({ ...prev, [m.id]: e.target.value }))}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); confirmarNota(m.id, e.target.value); } }}
      />
    );
  }

  function celdaEstado(m) {
    // Cuando el concepto sugiere que es una devolución, se avisa como
    // cualquier otra sugerencia (chip "Aplicar: devolución") en vez de
    // resaltar el desplegable con una caja de color -- elegirla sigue
    // siendo siempre una acción manual.
    return (
      <div className="celda-estado">
        <select
          className="select-estado"
          value={valorEstadoSelect(m)}
          onChange={e => cambiarEstado(m, e.target.value)}
        >
          <option value="pendiente">pendiente</option>
          <option value="pedida">pedida</option>
          <option value="factura_futura">factura futura</option>
          <option value="ignorar">ignorar</option>
          <option value="devolucion">devolución</option>
          <option value="resuelta">resuelta</option>
        </select>
        {m.probable_devolucion && (
          <button type="button" className="chip-sugerencia" onClick={() => cambiarEstado(m, 'devolucion')}>
            Aplicar: devolución
          </button>
        )}
      </div>
    );
  }

  // Unificada: ver si ya hay factura, Subir si no, "—" si es devolución (no
  // hay factura posible en una devolución).
  function celdaFactura(m, g) {
    if (m.es_devolucion) return <span className="vacio">—</span>;
    const facturaIds = m.factura_ids || [];
    if (facturaIds.length > 0) {
      return (
        <a className="link-factura" href={`/api/facturas/${facturaIds[0]}/archivo`} target="_blank" rel="noreferrer">
          ver
        </a>
      );
    }
    return (
      <SubirFactura
        hoja={g.hoja}
        clave={g.clave}
        etiqueta="Subir"
        conIcono={false}
        onResultado={r => subirFacturaDesdeFila(g, r)}
      />
    );
  }

  // Proveedor ya no muestra nada de devolución -- una devolución no tiene
  // proveedor (ver celdaNota, donde vive el jugador). "Sacar del grupo" se
  // mudó a la columna Grupo (icono "−" siempre visible).
  function celdaProveedor(m) {
    return (
      <input
        className="campo-proveedor"
        type="text"
        placeholder="Proveedor..."
        value={proveedoresManual[m.id] ?? (m.proveedor || m.proveedor_sugerido || '')}
        onChange={e => setProveedoresManual(prev => ({ ...prev, [m.id]: e.target.value }))}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); guardarProveedor(m.id, e.target.value); } }}
      />
    );
  }

  // Columna Grupo: "−" siempre visible en filas ya agrupadas (sacar), "+" en
  // filas sueltas (unir a un grupo existente del mismo banco).
  function celdaGrupo(m, g) {
    if (g.total > 1) {
      return <button type="button" className="btn-quitar" title="Sacar del grupo" onClick={() => separarDeGrupo(m.id)}>−</button>;
    }
    const destinos = gruposPorHoja[g.hoja] || [];
    return (
      <div className="grupo-wrap">
        <button type="button" className="btn-unir" title="Unir a un grupo" onClick={() => setGrupoAbiertoPara(prev => (prev === m.id ? null : m.id))}>+</button>
        {grupoAbiertoPara === m.id && (
          <div className="panel-grupos">
            <div className="tit-panel">Unir a un grupo</div>
            {destinos.length === 0 && <p className="muted" style={{ margin: '4px 8px', fontSize: 12 }}>No hay ningún grupo todavía.</p>}
            {destinos.map(d => (
              <button key={d.clave} type="button" onClick={() => unirAGrupo(m.id, d)}>{d.nombre}</button>
            ))}
          </div>
        )}
      </div>
    );
  }

  function celdaProyecto(m) {
    return (
      <>
        <select className="select-proyecto" value={m.proyecto_id || ''} onChange={e => asignarProyecto(m.id, e.target.value)}>
          <option value="">—</option>
          {proyectos.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select>
        {!m.proyecto_id && m.proyecto_sugerido && (
          <button type="button" className="chip-sugerencia" style={{ display: 'block', marginTop: 4 }} onClick={() => asignarProyecto(m.id, m.proyecto_sugerido.id)}>
            Aplicar: {m.proyecto_sugerido.nombre}
          </button>
        )}
      </>
    );
  }

  // La interacción de LarpManager vive aquí, no en la Nota -- son dos
  // conceptos distintos (ver resolverConLarpManager). Se lee siempre de
  // m.larpmanager_candidatos (guardado en BD al subir el CSV), NUNCA de un
  // estado que solo viva en el navegador -- si dependiera de eso, el botón
  // desaparecería al recargar la página o volver más tarde, aunque el cruce
  // ya estuviera hecho, y habría que subir el mismo CSV otra vez para nada.
  function celdaLarpManager(m) {
    const guardado = m.datos_originales?.larpmanager;
    if (m.estado === 'resuelta') return guardado ?? <span className="vacio">—</span>;

    const resultado = m.larpmanager_candidatos;
    if (resultado?.tipo === 'match' && resultado.candidatos?.length) {
      const c = resultado.candidatos[0];
      return (
        <button type="button" className="chip-sugerencia" onClick={() => resolverConLarpManager(m, c)}>
          Aplicar: {c.nombreReal} — {c.evento}
        </button>
      );
    }
    if (resultado?.tipo === 'ambiguo' && resultado.candidatos?.length) {
      return (
        <div className="opciones-lote">
          {resultado.candidatos.map((c, i) => (
            <button key={i} type="button" className="chip-sugerencia" style={{ display: 'block', marginTop: 4 }} onClick={() => resolverConLarpManager(m, c)}>
              Aplicar: {c.nombreReal} — {c.evento} ({Number(c.importe).toFixed(2)}€)
            </button>
          ))}
        </div>
      );
    }
    return guardado ?? <span className="vacio">—</span>;
  }

  function filaMovimiento(m, g, esInicioGrupo) {
    return (
      <div role="row" key={m.id} className={`fila-tabla${esInicioGrupo ? ' inicio-grupo' : ''}`} style={{ gridTemplateColumns: plantillaColumnas }}>
        <Celda col="Grupo" stickyLefts={stickyLefts}>{celdaGrupo(m, g)}</Celda>
        <Celda col="Fecha" className="muted" stickyLefts={stickyLefts}>{m.fecha ? new Date(m.fecha).toLocaleDateString('es-ES') : ''}</Celda>
        <Celda col="Concepto" className="concepto" stickyLefts={stickyLefts}>{m.concepto?.slice(0, 80)}</Celda>
        <Celda col="Banco" className="muted banco">{g.hoja}</Celda>
        <Celda col="Proveedor" className="proveedor">{celdaProveedor(m)}</Celda>
        <Celda col="Importe" className="importe num">{Number(m.importe).toFixed(2)}€</Celda>
        <Celda col="Estado">{celdaEstado(m)}</Celda>
        <Celda col="Factura">{celdaFactura(m, g)}</Celda>
        <Celda col="Nota">{celdaNota(m, g)}</Celda>
        <Celda col="Proyecto">{celdaProyecto(m)}</Celda>
        {columnasVisiblesExtra.map(c => (
          <Celda key={c} col={c} className={c === 'larpmanager' ? '' : 'muted'}>
            {c === 'larpmanager' ? celdaLarpManager(m) : (m.datos_originales?.[c] ?? <span className="vacio">—</span>)}
          </Celda>
        ))}
      </div>
    );
  }

  function filaGrupo(g) {
    // Solo se agrupa visualmente cuando hay mas de una linea de verdad (contando el
    // total real del grupo, no lo que quede tras filtrar).
    if (g.total <= 1) return null;
    const pendientesGrupo = g.total - g.resueltas;
    const permiteAccionesGrupo = pendientesGrupo > 0;
    const sugerenciaProveedorGrupo = g.movimientos.find(m => m.proveedor_sugerido)?.proveedor_sugerido || null;
    return (
      <div role="row" className="fila-tabla fila-grupo" key={`g-${g.id}`} style={{ gridTemplateColumns: plantillaColumnas }}>
        <Celda col="Grupo" stickyLefts={stickyLefts} />
        <Celda col="Fecha" stickyLefts={stickyLefts} />
        <Celda col="Concepto" stickyLefts={stickyLefts}>
          <div className="grupo-nombre">{nombreGrupoMostrado(g)} <span className="categoria-texto">· {ETIQUETAS[g.categoria]}</span></div>
          <div className="meta">{g.resueltas} de {g.total} resueltas</div>
        </Celda>
        <Celda col="Banco" className="muted banco">{g.hoja}</Celda>
        <Celda col="Proveedor">
          <input
            className="campo-proveedor"
            type="text"
            placeholder=""
            value={proveedoresGrupo[g.id] ?? (sugerenciaProveedorGrupo || '')}
            onChange={e => setProveedoresGrupo(prev => ({ ...prev, [g.id]: e.target.value }))}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); guardarProveedorGrupo(g, e.target.value); } }}
          />
        </Celda>
        <Celda col="Importe">{g.importeTotal.toFixed(2)}€</Celda>
        <Celda col="Estado">
          {permiteAccionesGrupo && (
            <select className="select-estado" defaultValue="" onChange={e => { if (e.target.value) cambiarEstadoGrupo(g, e.target.value); e.target.value = ''; }}>
              <option value="" disabled>estado...</option>
              <option value="pedida">pedida</option>
              <option value="resuelta">resuelta</option>
            </select>
          )}
        </Celda>
        <Celda col="Factura" />
        <Celda col="Nota">
          {permiteAccionesGrupo && (
            <>
              {g.sugerenciaNota && (
                <button type="button" className="chip-sugerencia" onClick={() => confirmarNotaGrupo(g, g.sugerenciaNota)}>
                  Aplicar: &quot;{g.sugerenciaNota}&quot; ({pendientesGrupo} línea{pendientesGrupo === 1 ? '' : 's'})
                </button>
              )}
              <input
                className="campo-nota"
                type="text"
                placeholder=""
                value={notasGrupo[g.id] || ''}
                onChange={e => setNotasGrupo(prev => ({ ...prev, [g.id]: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); confirmarNotaGrupo(g, e.target.value); } }}
              />
            </>
          )}
        </Celda>
        <Celda col="Proyecto">
          <select className="select-proyecto" defaultValue="" onChange={e => { asignarProyectoGrupo(g, e.target.value === '__quitar__' ? '' : e.target.value); e.target.value = ''; }}>
            <option value="" disabled>proyecto...</option>
            <option value="__quitar__">— (quitar)</option>
            {proyectos.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        </Celda>
        {columnasVisiblesExtra.map(c => <Celda key={c} col={c} />)}
      </div>
    );
  }

  return (
    <div>
      {filtroLote && (
        <div className="barra-filtro-lote">
          <span>Mostrando {filtroLote.ids.size} línea(s) de la última subida ({filtroLote.total} archivo(s) subidos).</span>
          <button type="button" className="secundario" onClick={onQuitarFiltro}>Ver todo el trimestre</button>
        </div>
      )}
      {filtroLote?.sinEncontrar?.length > 0 && (
        <div className="lista-sin-encontrar">
          <p className="muted" style={{ margin: '0 0 8px' }}>{filtroLote.sinEncontrar.length} archivo(s) sin ninguna línea parecida — revisa a mano:</p>
          {filtroLote.sinEncontrar.map((f, i) => (
            <div key={i} className="fila-sin-encontrar">
              <div className="fila-sin-encontrar-info">
                <span>
                  {f.nombreArchivo}
                  {f.facturaId && (
                    <a className="link-factura" style={{ marginLeft: 8 }} href={`/api/facturas/${f.facturaId}/archivo`} target="_blank" rel="noreferrer">
                      ver archivo
                    </a>
                  )}
                </span>
                <span className="muted">{f.detalle}</span>
              </div>
              {f.facturaId && onResolverImporteManual && (
                <div className="importe-manual">
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="Importe (ej. 45,00)"
                    value={importesManual[f.facturaId] || ''}
                    onChange={e => setImportesManual(prev => ({ ...prev, [f.facturaId]: e.target.value }))}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); guardarImporteManual(f); } }}
                    disabled={guardandoImporte === f.facturaId}
                  />
                  <button type="button" className="secundario" onClick={() => guardarImporteManual(f)} disabled={guardandoImporte === f.facturaId}>
                    {guardandoImporte === f.facturaId ? 'Buscando...' : 'Buscar coincidencia'}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="buscador-fila">
        <div className="grupo-tb">
          <input type="text" placeholder="Buscar en cualquier columna..." value={busqueda} onChange={e => setBusqueda(e.target.value)} />
        </div>
        <div className="div-v" />
        <div style={{ position: 'relative' }}>
          <button type="button" className="secundario" onClick={() => setMostrarFechas(v => !v)}>Fechas</button>
          {mostrarFechas && (
            <div className="panel-columnas">
              <label className="muted" style={{ fontSize: 13, display: 'block', marginBottom: 8 }}>
                Desde <input type="date" value={desde} onChange={e => onDesdeChange(e.target.value)} style={{ marginLeft: 4 }} />
              </label>
              <label className="muted" style={{ fontSize: 13, display: 'block' }}>
                Hasta <input type="date" value={hasta} onChange={e => onHastaChange(e.target.value)} style={{ marginLeft: 4 }} />
              </label>
              {(desde || hasta) && (
                <button type="button" className="secundario" style={{ marginTop: 8 }} onClick={() => { onDesdeChange(''); onHastaChange(''); }}>Ver todo</button>
              )}
            </div>
          )}
        </div>
        <div className="div-v" />
        <label className="toggle-pendientes">
          <input type="checkbox" checked={soloPendientes} onChange={e => setSoloPendientes(e.target.checked)} />
          Solo pendientes
        </label>
        <div className="div-v" />
        <div className="grupo-tb">
          <button type="button" className="secundario" disabled={!ordenPor} onClick={() => setOrdenPor(null)}>
            Agrupar proveedores
          </button>
          <button type="button" className="secundario" disabled={recalculando} onClick={onRecalcular}>
            {recalculando ? 'Reagrupando...' : 'Reagrupar proveedores'}
          </button>
        </div>
        <div className="div-v" />
        <div style={{ position: 'relative' }}>
          <button type="button" className="secundario" onClick={() => setMostrarColumnas(v => !v)}>Columnas</button>
          {mostrarColumnas && (
            <div className="panel-columnas">
              {columnasExtra.length === 0 && <p className="muted" style={{ margin: 0 }}>No hay columnas extra en los datos de este trimestre.</p>}
              {columnasExtra.map(c => (
                <label key={c} className="fila-checkbox">
                  <input type="checkbox" checked={columnasExtraVisibles.has(c)} onChange={() => alternarColumnaExtra(c)} />
                  {c}
                </label>
              ))}
            </div>
          )}
        </div>
        <span className="pend" style={{ marginLeft: 'auto' }} onClick={() => setSoloPendientes(true)}>{pendientes}</span>
      </div>

      {grupos.length === 0 && <p className="muted">Nada que coincida con este filtro.</p>}

      <div className="tabla-movimientos-envoltura" role="table">
        <div role="rowgroup">
          <div role="row" className="fila-tabla-cabecera" style={{ gridTemplateColumns: plantillaColumnas }}>
            {columnasTodas.map(c => (
              <Celda key={c} col={c} cabecera stickyLefts={stickyLefts}>
                <span className="etiqueta-orden" onClick={() => alternarOrden(c)}>
                  {c}{ordenPor?.campo === c ? (ordenPor.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                </span>
                <span className="resize-handle" onPointerDown={e => iniciarArrastre(e, c)} />
              </Celda>
            ))}
          </div>
        </div>
        <div role="rowgroup">
          {ordenPor
            ? filasOrdenadas.map(({ m, g }) => filaMovimiento(m, g))
            : grupos.map(g => (
                <Fragment key={g.id}>
                  {filaGrupo(g)}
                  {g.movimientos.map((m, i) => filaMovimiento(m, g, g.total <= 1 && i === 0))}
                </Fragment>
              ))}
        </div>
      </div>
    </div>
  );
}
