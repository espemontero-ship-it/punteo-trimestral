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

// La columna Grupo (los iconos "−" sacar y "+" unir) se quitó el 2026-08-15:
// agrupar y desagrupar se hace escribiendo o borrando el Proveedor, que además
// cruza textos distintos del banco Y bancos distintos, cosa que el "+" no
// hacía. El backend (/api/movimientos/:id/separar y /unir, y sus funciones en
// lib/agrupador.cjs) se deja intacto a propósito, para poder rescatar la
// columna en un solo commit si algún día hace falta separar líneas que el
// banco escribe idénticas.
const COLUMNAS_BASE = ['Fecha', 'Concepto', 'Banco', 'Proveedor', 'Importe', 'Estado', 'Factura', 'Nota', 'Proyecto'];
const ANCHO_DEFECTO = { Fecha: 85, Concepto: 200, Banco: 85, Proveedor: 150, Importe: 80, Estado: 130, Factura: 90, Nota: 135, Proyecto: 110 };
const ANCHO_EXTRA_DEFECTO = 120;

// Celda vive fuera del componente a propósito: si se define dentro (como
// estaba antes), React la trata como un tipo de componente nuevo en cada
// render y desmonta/remonta todo lo de dentro -- incluidos los <input>, que
// pierden el foco en cada tecla. stickyLefts se pasa como prop en vez de
// leerlo de un cierre porque Celda ya no tiene acceso al estado del componente.
function claseCeldaTabla(col) {
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

// Único elemento para TODA sugerencia del sistema, sea del tipo que sea:
// nota aprendida, proveedor, proyecto, devolución probable, jugador, cruce de
// LarpManager o factura de una subida en lote. Antes cada una se pintaba
// distinta -- unas como chip de texto y otras metidas dentro del campo de la
// usuaria, donde eran indistinguibles de lo que había escrito ella.
// Pulsar el texto la acepta; pulsar la ✕ la descarta (solo mientras dure la
// sesión). Fuera del componente principal a propósito, igual que Celda: si se
// define dentro, React lo trata como un tipo nuevo en cada render y los
// <input> de alrededor pierden el foco en cada tecla.
function Sugerencia({ texto, onAplicar, onDescartar }) {
  return (
    <span className="sugerencia" role="group">
      <span className="texto-sug" onClick={onAplicar} style={{ cursor: 'pointer' }}>{texto}</span>
      <button type="button" className="sugerencia-descartar" title="Descartar esta sugerencia" onClick={onDescartar}>✕</button>
    </span>
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
  proveedores, proyectos, onCambio, filtroLote,
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
  const [modoDevolucion, setModoDevolucion] = useState(new Set());
  const [jugadorManual, setJugadorManual] = useState({});
  // Sugerencias que se han descartado con la ✕. Solo mientras dure la sesión:
  // al recargar vuelven. Guardar el rechazo para siempre es otro paso, aún
  // sin decidir.
  const [descartadas, setDescartadas] = useState(new Set());
  const descartar = k => setDescartadas(prev => new Set(prev).add(k));
  const viva = k => !descartadas.has(k);

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
        movimientos: g.movimientos.filter(m => {
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

  // Un grupo puede abarcar varias parejas hoja+clave: pasa cuando se ha
  // unificado por proveedor (el mismo proveedor real llega del banco con
  // conceptos distintos, ej. "COMPRA EN ALSA INTERNET" y "REGULARIZACION
  // COMPRA EN ALSA INTERNET"). Las acciones de grupo tienen que aplicarse a
  // todas, o se quedarían líneas sin actualizar. Un solo aviso al final.
  async function porCadaClave(g, url, extra, { mensajeOk, mensajeError }) {
    const claves = g.claves?.length ? g.claves : [{ hoja: g.hoja, clave: g.clave }];
    for (const k of claves) {
      const r = await apiFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hoja: k.hoja, clave: k.clave, ...extra }),
      }, { mensajeError });
      if (!r) return false;
    }
    if (mensajeOk) mostrarToast(mensajeOk, 'ok');
    return true;
  }

  async function confirmarNotaGrupo(g, nota) {
    const limpia = (nota ?? '').trim();
    const ok = await porCadaClave(g, `/api/proveedores/confirmar-grupo`, { nota: limpia }, {
      mensajeOk: `${g.total - g.resueltas} línea(s) confirmadas`,
      mensajeError: 'No se pudo confirmar el grupo.',
    });
    // Igual que en guardarProveedorGrupo: se limpia lo tecleado para que el
    // guardado al salir del campo no repita el mismo envío tras un Enter.
    if (ok) {
      setNotasGrupo(prev => { const n = { ...prev }; delete n[g.id]; return n; });
      onCambio();
    }
  }

  async function cambiarEstadoGrupo(g, nuevoEstado) {
    if (nuevoEstado === 'resuelta') {
      // La nota es opcional: se guarda si hay algo escrito, pero no bloquea marcar el grupo como resuelto.
      const nota = (notasGrupo[g.id] ?? '').trim();
      const ok = await porCadaClave(g, `/api/proveedores/confirmar-grupo`, { nota }, {
        mensajeOk: `${g.total - g.resueltas} línea(s) confirmadas`,
        mensajeError: 'No se pudo confirmar el grupo.',
      });
      if (ok) onCambio();
      return;
    }
    if (nuevoEstado === 'pedida') {
      const ok = await porCadaClave(g, `/api/proveedores/pendiente`, {}, {
        mensajeOk: 'Marcadas como pedida, esperando al proveedor',
        mensajeError: 'No se pudo marcar.',
      });
      if (ok) onCambio();
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
        // Ya NO se prellena con m.jugador_sugerido: la sugerencia se pinta
        // aparte, como todas las demás, y el campo se queda vacío.
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
    const r = await porCadaClave(g, `/api/proveedores/proveedor-grupo`, { proveedor: (valor ?? '').trim() }, {
      mensajeOk: 'Guardado', mensajeError: 'No se pudo guardar.',
    });
    // Se limpia lo tecleado al guardar bien: así el guardado al salir del
    // campo (onBlur) no vuelve a mandar lo mismo justo después de un Enter,
    // que contaría dos veces en la memoria aprendida.
    if (r) {
      setProveedoresGrupo(prev => { const n = { ...prev }; delete n[g.id]; return n; });
      onCambio();
    }
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

  async function asignarProyecto(movimientoId, proyectoId) {
    const r = await apiFetch(`/api/movimientos/${movimientoId}/proyecto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ proyectoId: proyectoId || null }),
    }, { mensajeError: 'No se pudo guardar el proyecto.' });
    if (r) onCambio();
  }

  async function asignarProyectoGrupo(g, proyectoId) {
    const ok = await porCadaClave(g, `/api/proveedores/proyecto-grupo`, { proyectoId: proyectoId || null }, {
      mensajeError: 'No se pudo guardar el proyecto.',
    });
    if (ok) onCambio();
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
  // Fecha y Concepto se quedan fijas al hacer scroll horizontal -- cada una
  // necesita su propio left, calculado a partir de los anchos de las que van
  // antes (misma fuente de verdad que la plantilla de arriba).
  const anchoFecha = anchoDe('Fecha');
  const stickyLefts = { Fecha: 0, Concepto: anchoFecha };

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
          {m.jugador_sugerido && viva(`jug:${m.id}`) ? (
            <Sugerencia
              texto={m.jugador_sugerido}
              onAplicar={() => {
                setJugadorManual(prev => ({ ...prev, [m.id]: m.jugador_sugerido }));
                descartar(`jug:${m.id}`);
              }}
              onDescartar={() => descartar(`jug:${m.id}`)}
            />
          ) : (
          <input
            className="campo-proveedor"
            type="text"
            placeholder="Jugador en LarpManager..."
            value={jugadorManual[m.id] ?? ''}
            onChange={e => setJugadorManual(prev => ({ ...prev, [m.id]: e.target.value }))}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); confirmarDevolucion(m); } }}
          />
          )}
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
    // La nota de una línea resuelta también se edita. Antes se pintaba como
    // texto plano y no había dónde escribir: para corregir o borrar una nota
    // había que devolver la línea a pendiente, cambiarla y volver a
    // resolverla. Mismo criterio que el desplegable de Estado, que es siempre
    // editable a propósito para poder deshacer lo que se hizo mal.
    //
    // A una línea ya resuelta no se le proponen sugerencias: ya tiene su
    // respuesta, y una píldora encima taparía la nota que hay que poder ver y
    // corregir. Solo se le enseña su campo.
    const resuelta = m.estado === 'resuelta';

    // Una clave por candidato, no por línea: descartar una opción no puede
    // llevarse por delante las demás, que son alternativas entre las que hay
    // que poder seguir eligiendo. Se conserva el índice original al filtrar,
    // porque si no las claves se recolocan y descartar una afectaría a otra.
    const opcionesLote = (filtroLote?.ambiguos?.[m.id] || [])
      .map((o, i) => ({ o, i }))
      .filter(({ i }) => viva(`lote:${m.id}:${i}`));
    if (!resuelta && opcionesLote?.length) {
      return (
        <div className="sugerencias-lista">
          {/* Esta frase existía y se borró en el commit 88bfdfc (2026-08-03)
              sin pedirlo: sin ella aparecen dos opciones sin explicar por qué
              hay que elegir. */}
          <p className="muted" style={{ margin: '0 0 4px', fontSize: 11 }}>Varias facturas con este importe:</p>
          {opcionesLote.map(({ o, i }) => (
            <Sugerencia
              key={i}
              texto={o.esCombo
                ? `combinar factura${o.otrasFacturas.length > 1 ? 's' : ''} ${o.otrasFacturas.map(x => x.monto != null ? `${x.numero} (${Number(x.monto).toFixed(2)}€)` : x.numero).join(' + ')}`
                : `factura ${o.numero}${o.facturaConcepto ? ` (${o.facturaConcepto})` : ''}`}
              onAplicar={() => elegirCandidato(o)}
              onDescartar={() => descartar(`lote:${m.id}:${i}`)}
            />
          ))}
        </div>
      );
    }
    // La sugerencia YA NO se mete dentro del campo: va aparte, encima. El
    // campo muestra solo lo que haya escrito la usuaria.
    const sugerencia = g.sugerenciaNota;
    return (
      <>
        {!resuelta && sugerencia && viva(`nota:${m.id}`) ? (
          <Sugerencia
            texto={sugerencia}
            onAplicar={() => confirmarNota(m.id, sugerencia)}
            onDescartar={() => descartar(`nota:${m.id}`)}
          />
        ) : (
        <input
          className="campo-nota"
          type="text"
          placeholder=""
          // Enseña la nota que ya está guardada. Antes arrancaba en blanco
          // siempre: no veías lo que había, así que no se podía corregir ni
          // borrar, solo escribir encima a ciegas.
          value={notasManual[m.id] ?? (m.nota_final || '')}
          onChange={e => setNotasManual(prev => ({ ...prev, [m.id]: e.target.value }))}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); confirmarNota(m.id, e.target.value); } }}
          // Guardar también al salir del campo: antes solo se guardaba con
          // Enter, así que escribir y hacer clic en otro sitio tiraba lo
          // escrito sin avisar.
          onBlur={e => {
            const v = e.target.value.trim();
            if (notasManual[m.id] !== undefined && v !== (m.nota_final || '')) confirmarNota(m.id, v);
          }}
        />
        )}
      </>
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
        {m.probable_devolucion && viva(`devo:${m.id}`) && (
          <Sugerencia
            texto="devolución"
            onAplicar={() => cambiarEstado(m, 'devolucion')}
            onDescartar={() => descartar(`devo:${m.id}`)}
          />
        )}
      </div>
    );
  }

  // Unificada: ver si ya hay factura, Subir si no, "—" si es devolución (no
  // hay factura posible en una devolución).
  function celdaFactura(m, g) {
    if (m.es_devolucion) return <span className="vacio">—</span>;
    // El número de cada factura, no la palabra "ver": es el nombre que lleva
    // el archivo dentro del zip que va a la gestoría, así que lo que ves en
    // pantalla y lo que ella recibe se llaman igual. Con varias, separadas por
    // coma y cada una abre la suya. Antes solo se podía abrir la primera, y
    // sin saber cuál era.
    const facturas = m.facturas || [];
    if (facturas.length > 0) {
      return (
        <span>
          {facturas.map((f, i) => (
            <Fragment key={f.id}>
              {i > 0 && ', '}
              <a className="link-factura" href={`/api/facturas/${f.id}/archivo`} target="_blank" rel="noreferrer">
                {f.numero}
              </a>
            </Fragment>
          ))}
        </span>
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
    // Igual que la nota: la sugerencia va aparte, nunca dentro del campo.
    const sugerido = !m.proveedor ? m.proveedor_sugerido : null;
    return (
      <>
        {sugerido && viva(`prov:${m.id}`) ? (
          <Sugerencia
            texto={sugerido}
            onAplicar={() => guardarProveedor(m.id, sugerido)}
            onDescartar={() => descartar(`prov:${m.id}`)}
          />
        ) : (
        <input
          className="campo-proveedor"
          type="text"
          placeholder="Proveedor..."
          value={proveedoresManual[m.id] ?? (m.proveedor || '')}
          onChange={e => setProveedoresManual(prev => ({ ...prev, [m.id]: e.target.value }))}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); guardarProveedor(m.id, e.target.value); } }}
          onBlur={e => {
            const v = e.target.value.trim();
            if (proveedoresManual[m.id] !== undefined && v !== (m.proveedor || '')) guardarProveedor(m.id, v);
          }}
        />
        )}
      </>
    );
  }

  function celdaProyecto(m) {
    return (
      <>
        <select className="select-proyecto" value={m.proyecto_id || ''} onChange={e => asignarProyecto(m.id, e.target.value)}>
          <option value="">—</option>
          {proyectos.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select>
        {!m.proyecto_id && m.proyecto_sugerido && viva(`proy:${m.id}`) && (
          <Sugerencia
            texto={m.proyecto_sugerido.nombre}
            onAplicar={() => asignarProyecto(m.id, m.proyecto_sugerido.id)}
            onDescartar={() => descartar(`proy:${m.id}`)}
          />
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
    if (resultado?.tipo === 'match' && resultado.candidatos?.length && viva(`lm:${m.id}`)) {
      const c = resultado.candidatos[0];
      return (
        <Sugerencia
          texto={`${c.nombreReal} — ${c.evento}`}
          onAplicar={() => resolverConLarpManager(m, c)}
          onDescartar={() => descartar(`lm:${m.id}`)}
        />
      );
    }
    if (resultado?.tipo === 'ambiguo' && resultado.candidatos?.length) {
      // Igual que en las facturas de un lote: una clave por candidato, con el
      // índice original conservado, para que descartar uno no quite los otros.
      const vivos = resultado.candidatos.map((c, i) => ({ c, i })).filter(({ i }) => viva(`lm:${m.id}:${i}`));
      if (vivos.length === 0) return guardado ?? <span className="vacio">—</span>;
      return (
        <div className="sugerencias-lista">
          {vivos.map(({ c, i }) => (
            <Sugerencia
              key={i}
              texto={`${c.nombreReal} — ${c.evento} (${Number(c.importe).toFixed(2)}€)`}
              onAplicar={() => resolverConLarpManager(m, c)}
              onDescartar={() => descartar(`lm:${m.id}:${i}`)}
            />
          ))}
        </div>
      );
    }
    return guardado ?? <span className="vacio">—</span>;
  }

  function filaMovimiento(m, g, esInicioGrupo) {
    return (
      <div role="row" key={m.id} className={`fila-tabla${esInicioGrupo ? ' inicio-grupo' : ''}`} style={{ gridTemplateColumns: plantillaColumnas }}>
        <Celda col="Fecha" className="muted" stickyLefts={stickyLefts}>{m.fecha ? new Date(m.fecha).toLocaleDateString('es-ES') : ''}</Celda>
        {/* El concepto se lee entero. Estuvo cortado a 80 caracteres desde el
            commit b2d2c79 (2026-07-27) sin que se pidiera ni se dijera en el
            mensaje del commit: cualquier concepto más largo se veía truncado
            y no había forma de leerlo desde la tabla. */}
        <Celda col="Concepto" className="concepto" stickyLefts={stickyLefts}>{m.concepto}</Celda>
        <Celda col="Banco" className="muted banco">{g.hoja}</Celda>
        <Celda col="Proveedor" className="proveedor">{celdaProveedor(m)}</Celda>
        <Celda col="Importe" className="importe num">{Number(m.importe).toFixed(2)}€</Celda>
        <Celda col="Estado">{celdaEstado(m)}</Celda>
        <Celda col="Factura" className="facturas">{celdaFactura(m, g)}</Celda>
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
        <Celda col="Fecha" stickyLefts={stickyLefts} />
        {/* Cada columna con lo suyo: en Concepto va lo que escribe el banco, y
            el proveedor va en la columna Proveedor. Antes el nombre del
            proveedor se pintaba aquí, con el campo de Proveedor vacío al
            lado -- la misma cosa en dos sitios, y en ninguno el que le toca. */}
        <Celda col="Concepto" stickyLefts={stickyLefts}>
          <div className="grupo-nombre">{nombreGrupo(g.clave)} <span className="categoria-texto">· {ETIQUETAS[g.categoria]}</span></div>
        </Celda>
        <Celda col="Banco" className="muted banco">{g.hoja}</Celda>
        <Celda col="Proveedor">
          {sugerenciaProveedorGrupo && viva(`provg:${g.id}`) ? (
            <Sugerencia
              texto={sugerenciaProveedorGrupo}
              onAplicar={() => guardarProveedorGrupo(g, sugerenciaProveedorGrupo)}
              onDescartar={() => descartar(`provg:${g.id}`)}
            />
          ) : (
          <input
            className="campo-proveedor"
            type="text"
            placeholder=""
            // Enseña el proveedor que el grupo ya tiene, no un campo vacío:
            // es donde se lee y donde se cambia o se borra (borrarlo desagrupa
            // y olvida).
            value={proveedoresGrupo[g.id] ?? (g.proveedor || '')}
            onChange={e => setProveedoresGrupo(prev => ({ ...prev, [g.id]: e.target.value }))}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); guardarProveedorGrupo(g, e.target.value); } }}
            onBlur={e => { if (proveedoresGrupo[g.id] !== undefined) guardarProveedorGrupo(g, e.target.value); }}
          />
          )}
        </Celda>
        {/* Sin total de grupo. Sumaba SIEMPRE las líneas del grupo entero,
            también las que "Solo pendientes" está ocultando, así que enseñaba
            un número que no cuadraba con nada de lo que había debajo: en
            Amazon, −617,86 € encima de tres líneas que suman −421,39 €. */}
        <Celda col="Importe" />
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
              {g.sugerenciaNota && viva(`notag:${g.id}`) && (
                <Sugerencia
                  texto={`${g.sugerenciaNota} · ${pendientesGrupo} línea${pendientesGrupo === 1 ? '' : 's'}`}
                  onAplicar={() => confirmarNotaGrupo(g, g.sugerenciaNota)}
                  onDescartar={() => descartar(`notag:${g.id}`)}
                />
              )}
              <input
                className="campo-nota"
                type="text"
                placeholder=""
                value={notasGrupo[g.id] || ''}
                onChange={e => setNotasGrupo(prev => ({ ...prev, [g.id]: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); confirmarNotaGrupo(g, e.target.value); } }}
                onBlur={e => { if (e.target.value.trim()) confirmarNotaGrupo(g, e.target.value); }}
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
      {/* Subir facturas ya no cambia lo que se ve en esta tabla. Antes, subir
          en Facturas dejaba Movimientos filtrado a las líneas de esa subida,
          con una barra para deshacerlo, y el aviso de las que no encontraron
          línea salía también aquí, en otra pantalla, pidiendo otra vez un
          importe ya escrito. Todo eso vive en Facturas, que es donde se sube.
          Aquí manda "Solo pendientes", como siempre. */}
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
