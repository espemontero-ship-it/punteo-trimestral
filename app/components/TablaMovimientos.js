'use client';

import { useState, useMemo, useRef, useEffect, Fragment } from 'react';
import { apiFetch, mostrarToast } from '../lib/toast';
import { useAnchosPersistidos } from '../lib/useAnchosPersistidos';
import SubirFactura from './SubirFactura';
import { ConfirmDialog } from './ConfirmDialog';

const ETIQUETAS = {
  fija: 'fija',
  mixta: 'mixta',
  nueva: 'nueva',
};

const ETIQUETA_ESTADO_PAGO = { pendiente: 'pendiente', resuelta: 'resuelto', ignorada: 'ignorar' };

const COLUMNAS_BASE = ['Fecha', 'Concepto', 'Banco', 'Proveedor', 'Importe', 'Estado', 'Factura', 'Nota', 'Proyecto'];
const ANCHO_DEFECTO = { Fecha: 85, Concepto: 200, Banco: 85, Proveedor: 150, Importe: 80, Estado: 130, Factura: 90, Nota: 135, Proyecto: 110 };
const ANCHO_EXTRA_DEFECTO = 120;

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

function Sugerencia({ texto, onAplicar, onDescartar }) {
  return (
    <span className="sugerencia" role="group">
      <span className="texto-sug" onClick={onAplicar} style={{ cursor: 'pointer' }}>{texto}</span>
      <button type="button" className="sugerencia-descartar" title="Descartar esta sugerencia" onClick={onDescartar}>✕</button>
    </span>
  );
}

function nombreGrupo(clave) {
  return (clave || '').replace(/ #\d+$/, '');
}

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
  const [ordenPor, setOrdenPor] = useState(null);
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

  const [descartadas, setDescartadas] = useState(new Set());
  const viva = k => !descartadas.has(k);

  const [confirmarDesvincular, setConfirmarDesvincular] = useState(null);

  const [vinculandoLm, setVinculandoLm] = useState(null);
  const [candidatosLm, setCandidatosLm] = useState(null);
  const [busquedaLm, setBusquedaLm] = useState('');
  const [verTodosLm, setVerTodosLm] = useState(false);
  const [guardandoLm, setGuardandoLm] = useState(false);
  const [desvinculando, setDesvinculando] = useState(false);

  async function desvincularLm() {
    if (!confirmarDesvincular) return;
    setDesvinculando(true);
    const r = await apiFetch(`/api/larpmanager-pagos/${confirmarDesvincular.pago.id}/desvincular`, {
      method: 'POST',
    }, { mensajeOk: 'Desvinculado', mensajeError: 'No se pudo desvincular.' });
    setDesvinculando(false);
    setConfirmarDesvincular(null);
    if (r) onCambio();
  }

  const descartar = k => setDescartadas(prev => new Set(prev).add(k));

  async function rechazar(k, clavesDe, tipo, valor) {
    setDescartadas(prev => new Set(prev).add(k));
    for (const { hoja, clave } of clavesDe) {
      await apiFetch('/api/sugerencias/rechazar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hoja, clave, tipo, valor: valor ?? '' }),
      }, { mensajeError: 'No se pudo guardar el rechazo.' });
    }
    onCambio();
  }

  function anchoDe(col) {
    return anchos[col] ?? ANCHO_DEFECTO[col] ?? ANCHO_EXTRA_DEFECTO;
  }

  function iniciarArrastre(e, col) {
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
    const startX = e.clientX;

    const celda = e.currentTarget.closest('.celda');
    const startWidth = celda ? celda.offsetWidth : anchoDe(col);
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

        movimientosTodos: g.movimientos,
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

  async function aplicarComboFacturas(m, combo) {
    const facturaIds = [combo.facturaId, ...(combo.otras || []).map(o => o.id)];
    const r = await apiFetch(`/api/movimientos/${m.id}/confirmar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nota: combo.concepto || '', facturaIds }),
    }, { mensajeOk: 'Guardado', mensajeError: 'No se pudo guardar.' });
    if (r) onCambio();
  }

  async function cambiarEstado(m, nuevoEstado) {

    if (nuevoEstado === 'devolucion') {
      alternarModoDevolucion(m);
      return;
    }
    if (nuevoEstado === 'resuelta') {

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

    if (ok) {
      setNotasGrupo(prev => { const n = { ...prev }; delete n[g.id]; return n; });
      onCambio();
    }
  }

  async function cambiarEstadoGrupo(g, nuevoEstado) {
    if (nuevoEstado === 'resuelta') {

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

  function alternarModoDevolucion(m) {
    setModoDevolucion(prev => {
      const next = new Set(prev);
      if (next.has(m.id)) {
        next.delete(m.id);
      } else {
        next.add(m.id);

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

    if (r) {
      setProveedoresGrupo(prev => { const n = { ...prev }; delete n[g.id]; return n; });
      onCambio();
    }
  }

  async function aplicarPago(m, pagoSugerido) {
    const r = await apiFetch(`/api/movimientos/${m.id}/vincular-pago`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pagoId: pagoSugerido.pagoId }),
    }, { mensajeOk: 'Vinculado', mensajeError: 'No se pudo vincular.' });
    if (r) onCambio();
  }

  async function elegirCandidato(opcion) {

    const nota = opcion.facturaConcepto || '';
    const facturaIds = opcion.esCombo ? [opcion.facturaId, ...opcion.otrasFacturas.map(o => o.id)] : [opcion.facturaId];
    const r = await apiFetch(`/api/movimientos/${opcion.movimientoId}/confirmar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nota, facturaIds }),
    }, { mensajeOk: 'Guardado', mensajeError: 'No se pudo guardar.' });
    if (r) onCambio();
  }

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

  const plantillaColumnas = columnasTodas
    .map(c => (c === 'Concepto' && anchos.Concepto === undefined
      ? `minmax(${ANCHO_DEFECTO.Concepto}px, 1fr)`
      : `${anchoDe(c)}px`))
    .join(' ');

  const envolturaRef = useRef(null);
  const [anchoVisible, setAnchoVisible] = useState(0);
  useEffect(() => {
    const el = envolturaRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const medir = () => setAnchoVisible(el.clientWidth);
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const anchoFecha = anchoDe('Fecha');
  const stickyLefts = { Fecha: 0, Concepto: anchoFecha };

  function valorEstadoSelect(m) {
    if (m.estado === 'resuelta') return 'resuelta';
    if (m.estado === 'pedida_pendiente') return 'pedida';
    if (m.estado === 'factura_futura') return 'factura_futura';
    if (m.estado === 'ignorada') return 'ignorar';
    return 'pendiente';
  }

  function celdaNota(m, g) {

    if (!modoDevolucion.has(m.id) && m.es_devolucion) {
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

          {!m.es_devolucion && m.jugador_sugerido && viva(`jug:${m.id}`) ? (
            <Sugerencia
              texto={m.jugador_sugerido}
              onAplicar={() => {
                setJugadorManual(prev => ({ ...prev, [m.id]: m.jugador_sugerido }));
                descartar(`jug:${m.id}`);
              }}
              onDescartar={() => rechazar(`jug:${m.id}`, [{ hoja: m.hoja, clave: m.clave }], 'jugador', m.jugador_sugerido)}
            />
          ) : (
          <input
            className="campo-proveedor"
            type="text"
            placeholder="Jugador en LarpManager..."

            value={jugadorManual[m.id] ?? (m.jugador_larpmanager || '')}
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

    const resuelta = m.estado === 'resuelta';

    const opcionesLote = (filtroLote?.ambiguos?.[m.id] || [])
      .map((o, i) => ({ o, i }))
      .filter(({ i }) => viva(`lote:${m.id}:${i}`));
    if (!resuelta && opcionesLote?.length) {
      return (
        <div className="sugerencias-lista">

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

    if (!resuelta && m.pago_sugerido && viva(`pago:${m.id}`)) {
      return (
        <Sugerencia
          texto={m.pago_sugerido.texto}
          onAplicar={() => aplicarPago(m, m.pago_sugerido)}
          onDescartar={() => rechazar(`pago:${m.id}`, [{ hoja: m.hoja, clave: m.clave }], 'pago', String(m.pago_sugerido.pagoId))}
        />
      );
    }

    const sugerencia = g.sugerenciaNota;
    return (
      <>
        {!resuelta && sugerencia && viva(`nota:${m.id}`) ? (
          <Sugerencia
            texto={sugerencia}
            onAplicar={() => confirmarNota(m.id, sugerencia)}
            onDescartar={() => rechazar(`nota:${m.id}`, (g.claves?.length ? g.claves : [{ hoja: g.hoja, clave: g.clave }]), 'nota', sugerencia)}
          />
        ) : (
        <input
          className="campo-nota"
          type="text"
          placeholder=""

          value={notasManual[m.id] ?? (m.nota_final || '')}
          onChange={e => setNotasManual(prev => ({ ...prev, [m.id]: e.target.value }))}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); confirmarNota(m.id, e.target.value); } }}

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
            onDescartar={() => rechazar(`devo:${m.id}`, [{ hoja: m.hoja, clave: m.clave }], 'devolucion', '')}
          />
        )}
      </div>
    );
  }

  function celdaFactura(m, g) {
    if (m.es_devolucion) return <span className="vacio">—</span>;

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

    if (m.estado === 'resuelta' || m.estado === 'ignorada') return null;

    const combos = (m.combos_factura || []).filter((c, i) => viva(`combo:${m.id}:${i}`));
    return (
      <div className="celda-estado">
        {combos.map((c, i) => {
          const numeros = [c.numero, ...(c.otras || []).map(o => o.numero)].join(' + ');
          const ids = [c.facturaId, ...(c.otras || []).map(o => o.id)].join(',');

          const falla = c.exacto === false && typeof c.diferencia === 'number';
          const desvio = falla
            ? ` · NO CUADRA: ${c.diferencia > 0 ? 'faltan' : 'sobran'} ${Math.abs(c.diferencia).toFixed(2)}€`
            : '';
          return (
            <Sugerencia
              key={c.facturaId}
              texto={`facturas ${numeros}${desvio}`}
              onAplicar={() => aplicarComboFacturas(m, c)}
              onDescartar={() => rechazar(`combo:${m.id}:${i}`, [{ hoja: m.hoja, clave: m.clave }], 'combo', ids)}
            />
          );
        })}
        <SubirFactura
          hoja={g.hoja}
          clave={g.clave}
          etiqueta="Subir"
          conIcono={false}
          onResultado={r => subirFacturaDesdeFila(g, r)}
        />
      </div>
    );
  }

  function celdaProveedor(m) {

    const sugerido = !m.proveedor ? m.proveedor_sugerido : null;
    return (
      <>
        {sugerido && viva(`prov:${m.id}`) ? (
          <Sugerencia
            texto={sugerido}
            onAplicar={() => guardarProveedor(m.id, sugerido)}
            onDescartar={() => rechazar(`prov:${m.id}`, [{ hoja: m.hoja, clave: m.clave }], 'proveedor', sugerido)}
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
            onDescartar={() => rechazar(`proy:${m.id}`, [{ hoja: m.hoja, clave: m.clave }], 'proyecto', m.proyecto_sugerido.nombre)}
          />
        )}
      </>
    );
  }

  function editarVinculoLm(m) {
    const pagos = m.pagos_larpmanager || [];
    if (pagos.length === 0) return null;
    return pagos.map(p => (
      <button
        key={p.id}
        type="button"
        className="btn-editar-mini"
        title={`Quitar el vínculo con ${p.nombre}`}
        onClick={() => setConfirmarDesvincular({ pago: p, movimiento: m })}
      >✎</button>
    ));
  }

  function celdaLarpManager(m) {
    const guardado = m.datos_originales?.larpmanager;

    if (m.estado === 'resuelta') {
      return <>{guardado ?? <span className="vacio">—</span>}{editarVinculoLm(m)}{botonVincularLm(m)}</>;
    }

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

      const vivos = resultado.candidatos.map((c, i) => ({ c, i })).filter(({ i }) => viva(`lm:${m.id}:${i}`));
      if (vivos.length === 0) return <>{guardado ?? <span className="vacio">—</span>}{editarVinculoLm(m)}{botonVincularLm(m)}</>;
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

    return <>{guardado ?? <span className="vacio">—</span>}{editarVinculoLm(m)}{botonVincularLm(m)}</>;
  }

  function botonVincularLm(m) {
    if (Number(m.importe) <= 0) return null;
    if ((m.pagos_larpmanager || []).length > 0) return null;
    return (
      <button type="button" className="secundario" onClick={() => abrirVincularLm(m)}>
        {vinculandoLm === m.id ? 'Cerrar' : 'Vincular'}
      </button>
    );
  }

  async function abrirVincularLm(m) {
    if (vinculandoLm === m.id) { cerrarVincularLm(); return; }
    setVinculandoLm(m.id);
    setCandidatosLm(null);
    setBusquedaLm('');
    setVerTodosLm(false);
    const data = await apiFetch(`/api/movimientos/${m.id}/larpmanager-candidatos`, undefined, {
      mensajeError: 'No se pudieron cargar los pagos.',
    });
    setCandidatosLm((data && data.candidatos) || []);
  }

  function cerrarVincularLm() {
    setVinculandoLm(null);
    setCandidatosLm(null);
  }

  async function vincularPagoLm(m, pagoId) {
    setGuardandoLm(true);
    const r = await apiFetch(`/api/larpmanager-pagos/${pagoId}/vincular`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ movimientoId: m.id }),
    }, { mensajeOk: 'Vinculado', mensajeError: 'No se pudo vincular.' });
    setGuardandoLm(false);
    if (r) { cerrarVincularLm(); onCambio(); }
  }

  function panelVincularLm(m) {
    const plantilla = '210px 150px 90px 95px 100px 1fr 110px';

    const pegado = { width: anchoVisible || undefined };
    if (!candidatosLm) {
      return (
        <div className="panel-fila">
          <div className="panel-pegado" style={pegado}><span className="muted">Cargando...</span></div>
        </div>
      );
    }
    const q = busquedaLm.trim().toLowerCase();

    const sinMovimiento = candidatosLm.filter(c => !c.enlazado);
    const destacados = sinMovimiento.filter(c => c.suNombre || c.mismoImporte);
    let lista = sinMovimiento;
    let pie;
    if (q) {
      lista = candidatosLm.filter(c => `${c.nombreReal} ${c.evento || ''}`.toLowerCase().includes(q));
      pie = `${lista.length} con ese texto, incluidos los que ya tienen movimiento.`;
    } else if (!verTodosLm && destacados.length > 0) {
      lista = destacados;
      pie = <>{destacados.length} de {sinMovimiento.length} llevan su nombre o su importe.{' '}
        <a href="#" onClick={e => { e.preventDefault(); setVerTodosLm(true); }}>Ver todos</a></>;
    } else {

      pie = `Los ${sinMovimiento.length} pagos sin movimiento.`;
    }

    return (
      <div className="panel-fila">
       <div className="panel-pegado" style={pegado}>
        <p className="panel-titulo">Qué pago de LarpManager es este ingreso</p>

        <div className="buscador-fila" style={{ marginBottom: 6 }}>
          <input
            type="text"
            placeholder="Buscar por nombre o evento..."
            value={busquedaLm}
            onChange={e => setBusquedaLm(e.target.value)}
          />
          <span className="pend">{pie}</span>
        </div>
        <div className="tabla-movimientos-envoltura" role="table">
          <div role="row" className="fila-tabla-cabecera" style={{ gridTemplateColumns: plantilla }}>
            <Celda cabecera>Nombre</Celda>
            <Celda cabecera>Evento</Celda>
            <Celda cabecera>Importe</Celda>
            <Celda cabecera>Fecha</Celda>
            <Celda cabecera>Estado</Celda>
            <Celda cabecera>Movimiento</Celda>
            <Celda cabecera> </Celda>
          </div>
          {lista.slice(0, 60).map(c => (
            <div
              role="row"
              key={c.id}
              className={`fila-tabla${c.estado === 'pendiente' && !c.enlazado ? '' : ' contestado'}`}
              style={{ gridTemplateColumns: plantilla }}
            >
              <Celda>{c.nombreReal}</Celda>
              <Celda><span className="muted">{c.evento || '—'}</span></Celda>
              <Celda>{c.importe.toFixed(2)}€</Celda>
              <Celda><span className="muted">{c.fecha ? new Date(c.fecha).toLocaleDateString('es-ES') : '—'}</span></Celda>
              <Celda><span className="muted">{ETIQUETA_ESTADO_PAGO[c.estado] || c.estado}</span></Celda>
              <Celda className="envuelve">
                {c.enlazado
                  ? `${c.enlazado.fecha ? new Date(c.enlazado.fecha).toLocaleDateString('es-ES') : '—'} · ${c.enlazado.importe.toFixed(2)}€ · ${c.enlazado.concepto || ''}`
                  : <span className="vacio">—</span>}
              </Celda>

              <Celda>
                {c.estado === 'pendiente' && !c.enlazado ? (
                  <button type="button" className="secundario" disabled={guardandoLm} onClick={() => vincularPagoLm(m, c.id)}>
                    {guardandoLm ? '...' : 'Es este'}
                  </button>
                ) : <span className="vacio">—</span>}
              </Celda>
            </div>
          ))}
        </div>
        {lista.length > 60 && (
          <p className="muted" style={{ margin: '4px 0 0', fontSize: 12 }}>
            Se enseñan los 60 primeros. Escribe en el buscador para acotar.
          </p>
        )}
        <div style={{ marginTop: 12 }}>
          <button type="button" className="secundario" onClick={cerrarVincularLm}>Cancelar</button>
        </div>
       </div>
      </div>
    );
  }

  function filaMovimiento(m, g, esInicioGrupo) {
    return (
      <Fragment key={m.id}>
        {filaMovimientoSola(m, g, esInicioGrupo)}
        {vinculandoLm === m.id && panelVincularLm(m)}
      </Fragment>
    );
  }

  function filaMovimientoSola(m, g, esInicioGrupo) {
    return (
      <div role="row" className={`fila-tabla${esInicioGrupo ? ' inicio-grupo' : ''}`} style={{ gridTemplateColumns: plantillaColumnas }}>
        <Celda col="Fecha" className="muted" stickyLefts={stickyLefts}>{m.fecha ? new Date(m.fecha).toLocaleDateString('es-ES') : ''}</Celda>

        <Celda col="Concepto" className="concepto" stickyLefts={stickyLefts}>{m.concepto}</Celda>
        <Celda col="Banco" className="muted banco">{g.hoja}</Celda>
        <Celda col="Proveedor" className="proveedor">{celdaProveedor(m)}</Celda>
        <Celda col="Importe" className="importe num">{Number(m.importe).toFixed(2)}€</Celda>
        <Celda col="Estado">{celdaEstado(m)}</Celda>
        <Celda col="Factura" className="facturas">{celdaFactura(m, g)}</Celda>
        <Celda col="Nota">{celdaNota(m, g)}</Celda>
        <Celda col="Proyecto">{celdaProyecto(m)}</Celda>
        {columnasVisiblesExtra.map(c => (

          <Celda key={c} col={c} className={c === 'larpmanager' ? 'envuelve' : 'muted'}>
            {c === 'larpmanager' ? celdaLarpManager(m) : (m.datos_originales?.[c] ?? <span className="vacio">—</span>)}
          </Celda>
        ))}
      </div>
    );
  }

  function filaGrupo(g) {

    if (g.total <= 1) return null;
    const pendientesGrupo = g.total - g.resueltas;
    const permiteAccionesGrupo = pendientesGrupo > 0;

    const notasDelGrupo = new Set((g.movimientosTodos || g.movimientos).map(m => m.nota_final || ''));
    const notaComunGrupo = notasDelGrupo.size === 1 ? [...notasDelGrupo][0] : '';
    const sugerenciaProveedorGrupo = g.movimientos.find(m => m.proveedor_sugerido)?.proveedor_sugerido || null;
    return (
      <div role="row" className="fila-tabla fila-grupo" key={`g-${g.id}`} style={{ gridTemplateColumns: plantillaColumnas }}>
        <Celda col="Fecha" stickyLefts={stickyLefts} />

        <Celda col="Concepto" stickyLefts={stickyLefts}>
          <div className="grupo-nombre">{nombreGrupo(g.clave)} <span className="categoria-texto">· {ETIQUETAS[g.categoria]}</span></div>
        </Celda>
        <Celda col="Banco" className="muted banco">{g.hoja}</Celda>
        <Celda col="Proveedor">
          {sugerenciaProveedorGrupo && viva(`provg:${g.id}`) ? (
            <Sugerencia
              texto={sugerenciaProveedorGrupo}
              onAplicar={() => guardarProveedorGrupo(g, sugerenciaProveedorGrupo)}
              onDescartar={() => rechazar(`provg:${g.id}`, (g.claves?.length ? g.claves : [{ hoja: g.hoja, clave: g.clave }]), 'proveedor', sugerenciaProveedorGrupo)}
            />
          ) : (
          <input
            className="campo-proveedor"
            type="text"
            placeholder=""

            value={proveedoresGrupo[g.id] ?? (g.proveedor || '')}
            onChange={e => setProveedoresGrupo(prev => ({ ...prev, [g.id]: e.target.value }))}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); guardarProveedorGrupo(g, e.target.value); } }}
            onBlur={e => { if (proveedoresGrupo[g.id] !== undefined) guardarProveedorGrupo(g, e.target.value); }}
          />
          )}
        </Celda>

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
          {
            <>
              {permiteAccionesGrupo && g.sugerenciaNota && viva(`notag:${g.id}`) && (
                <Sugerencia
                  texto={`${g.sugerenciaNota} · ${pendientesGrupo} línea${pendientesGrupo === 1 ? '' : 's'}`}
                  onAplicar={() => confirmarNotaGrupo(g, g.sugerenciaNota)}
                  onDescartar={() => rechazar(`notag:${g.id}`, (g.claves?.length ? g.claves : [{ hoja: g.hoja, clave: g.clave }]), 'nota', g.sugerenciaNota)}
                />
              )}
              <input
                className="campo-nota"
                type="text"
                placeholder=""
                value={notasGrupo[g.id] ?? notaComunGrupo}
                onChange={e => setNotasGrupo(prev => ({ ...prev, [g.id]: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); confirmarNotaGrupo(g, e.target.value); } }}

                onBlur={e => { if (notasGrupo[g.id] !== undefined) confirmarNotaGrupo(g, e.target.value); }}
              />
            </>
          }
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

      <div className="tabla-movimientos-envoltura" role="table" ref={envolturaRef}>
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

      <ConfirmDialog
        abierto={!!confirmarDesvincular}
        titulo="¿Quitar este vínculo?"
        mensaje={confirmarDesvincular
          ? `El pago de ${confirmarDesvincular.pago.nombre} (${Number(confirmarDesvincular.pago.importe).toFixed(2)}€) vuelve a "Pagos sin emparejar" y esta línea deja de decir de quién es. La línea NO cambia de estado: si está resuelta, sigue resuelta — cámbialo en Estado si hace falta.`
          : ''}
        textoConfirmar={desvinculando ? 'Quitando...' : 'Quitar'}
        peligroso
        onConfirmar={desvincularLm}
        onCancelar={() => setConfirmarDesvincular(null)}
      />
    </div>
  );
}
