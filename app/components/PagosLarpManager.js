'use client';

import { useState, useEffect, useCallback, useMemo, Fragment } from 'react';
import { apiFetch, mostrarToast } from '../lib/toast';
import { useAnchosPersistidos } from '../lib/useAnchosPersistidos';

// Mismo motor de tabla que Movimientos y Facturas (CSS Grid, no <table>): una
// plantilla de anchos que se aplica a la cabecera y a cada fila, así que es
// imposible que se desalineen. Ver PROYECTO.md, "Toda lista de datos con
// columnas es una tabla de verdad".
const COLUMNAS = ['Nombre', 'Evento', 'Importe', 'Fecha', 'Por qué', 'Estado', 'Vincular'];
const ANCHO_DEFECTO = { Nombre: 200, Evento: 150, Importe: 90, Fecha: 95, 'Por qué': 430, Estado: 110, Vincular: 130 };

// Los mismos tres de Movimientos. Se guardan con el vocabulario de esa tabla
// ('resuelta'/'ignorada') para no tener dos nombres para lo mismo, y se
// enseñan como los lee la usuaria.
const ESTADOS = [
  ['pendiente', 'pendiente'],
  ['resuelta', 'resuelto'],
  ['ignorada', 'ignorar'],
];

// Fuera del componente a propósito: si se define dentro, React la trata como
// un tipo nuevo en cada render y los <select> de dentro pierden el foco.
function Celda({ className = '', cabecera, children, style }) {
  return (
    <div role={cabecera ? 'columnheader' : 'cell'} className={`celda ${className}`.trim()} style={style}>
      {children}
    </div>
  );
}

const eur = n => `${Number(n).toFixed(2)}€`;
const dia = f => (f ? new Date(f).toLocaleDateString('es-ES') : '—');

export default function PagosLarpManager({ onAbrirSubida, onCambio }) {
  const [pagos, setPagos] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [busqueda, setBusqueda] = useState('');
  const [soloPendientes, setSoloPendientes] = useState(true);
  const [ordenPor, setOrdenPor] = useState(null);           // { campo, dir } | null
  const [anchos, setAnchos] = useAnchosPersistidos('punteo-anchos-larpmanager');
  const [mostrarColumnas, setMostrarColumnas] = useState(false);
  const [columnasVisibles, setColumnasVisibles] = useState(() => new Set(COLUMNAS));
  // Vincular a mano: qué fila está abierta, con qué candidatas y con qué
  // histórico de esa persona.
  const [abierto, setAbierto] = useState(null);
  const [detalle, setDetalle] = useState(null);             // { candidatos, historial } | null
  const [verTodas, setVerTodas] = useState(false);
  const [guardando, setGuardando] = useState(false);

  // Entrar en la página ya cruza: el endpoint reparte y escribe los enlaces
  // antes de devolver la lista, así que lo que se ve aquí es lo que queda por
  // mirar a mano, no una predicción.
  const cargar = useCallback(async () => {
    setCargando(true);
    const data = await apiFetch('/api/larpmanager-sin-emparejar', undefined, {
      mensajeError: 'No se pudieron cargar los pagos.',
    });
    setPagos((data && data.pagos) || []);
    setCargando(false);
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  function anchoDe(col) {
    return anchos[col] ?? ANCHO_DEFECTO[col] ?? 140;
  }

  // Ver iniciarArrastre en TablaMovimientos.js para por qué se escucha en
  // window y por qué el try/catch alrededor de setPointerCapture.
  function iniciarArrastre(e, col) {
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
    const startX = e.clientX;
    const startWidth = anchoDe(col);
    function mover(ev) {
      setAnchos(prev => ({ ...prev, [col]: Math.max(50, startWidth + (ev.clientX - startX)) }));
    }
    function soltar() {
      window.removeEventListener('pointermove', mover);
      window.removeEventListener('pointerup', soltar);
    }
    window.addEventListener('pointermove', mover);
    window.addEventListener('pointerup', soltar);
  }

  function alternarColumna(col) {
    setColumnasVisibles(prev => {
      const next = new Set(prev);
      if (next.has(col)) next.delete(col); else next.add(col);
      return next;
    });
  }

  function alternarOrden(col) {
    setOrdenPor(prev => {
      if (!prev || prev.campo !== col) return { campo: col, dir: 'asc' };
      if (prev.dir === 'asc') return { campo: col, dir: 'desc' };
      return null;
    });
  }

  const valorDe = (p, col) => {
    if (col === 'Nombre') return p.nombre_real || '';
    if (col === 'Evento') return p.evento || '';
    if (col === 'Importe') return Number(p.importe);
    if (col === 'Fecha') return p.fecha || '';
    if (col === 'Por qué') return p.motivoTexto || '';
    if (col === 'Estado') return p.estado || 'pendiente';
    return '';
  };

  const visibles = useMemo(() => {
    let lista = pagos || [];
    // Igual que "Solo pendientes" en Movimientos: lo contestado no desaparece
    // de la aplicación, solo deja de estar delante. Quitando la marca salen
    // los ignorados y se les puede volver a poner pendiente.
    if (soloPendientes) lista = lista.filter(p => (p.estado || 'pendiente') === 'pendiente');
    const q = busqueda.trim().toLowerCase();
    if (q) {
      lista = lista.filter(p => COLUMNAS.some(c => String(valorDe(p, c)).toLowerCase().includes(q)));
    }
    if (ordenPor) {
      lista = [...lista].sort((a, b) => {
        const va = valorDe(a, ordenPor.campo), vb = valorDe(b, ordenPor.campo);
        const cmp = typeof va === 'number' && typeof vb === 'number'
          ? va - vb
          : String(va).localeCompare(String(vb), 'es');
        return ordenPor.dir === 'asc' ? cmp : -cmp;
      });
    }
    return lista;
  }, [pagos, busqueda, ordenPor, soloPendientes]);

  async function abrirPanel(p) {
    if (abierto === p.id) { cerrarPanel(); return; }
    setAbierto(p.id);
    setDetalle(null);
    setVerTodas(false);
    const data = await apiFetch(`/api/larpmanager-pagos/${p.id}/candidatos`, undefined, {
      mensajeError: 'No se pudieron cargar las líneas del banco.',
    });
    setDetalle(data ? { candidatos: data.candidatos || [], historial: data.historial || [] } : { candidatos: [], historial: [] });
  }

  function cerrarPanel() {
    setAbierto(null);
    setDetalle(null);
  }

  async function vincular(p, movimientoId) {
    setGuardando(true);
    const r = await apiFetch(`/api/larpmanager-pagos/${p.id}/vincular`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ movimientoId }),
    }, { mensajeOk: 'Vinculado', mensajeError: 'No se pudo vincular.' });
    setGuardando(false);
    if (r) {
      if (r.aprendidas > 0) mostrarToast('Aprendido cómo lo llama el banco: se aplicará a sus demás pagos.', 'ok');
      cerrarPanel();
      await cargar();
      if (onCambio) onCambio();
    }
  }

  async function cambiarEstado(p, estado) {
    const r = await apiFetch(`/api/larpmanager-pagos/${p.id}/estado`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ estado }),
    }, { mensajeError: 'No se pudo cambiar el estado.' });
    // Se recarga entero, no solo esa fila: sacar un pago del cruce libera la
    // línea del banco que tenía cogida, y eso cambia el "Por qué" de los
    // demás pagos de esa persona.
    if (r) await cargar();
  }

  const columnasMostradas = COLUMNAS.filter(c => columnasVisibles.has(c));
  const plantillaColumnas = columnasMostradas.map(c => `${anchoDe(c)}px`).join(' ');
  const anchoTotal = columnasMostradas.reduce((total, c) => total + anchoDe(c), 0);

  function contenido(col, p) {
    if (col === 'Nombre') return p.nombre_real;
    if (col === 'Evento') return <span className="muted">{p.evento || '—'}</span>;
    if (col === 'Importe') return <span className="num">{eur(p.importe)}</span>;
    if (col === 'Fecha') return <span className="muted">{dia(p.fecha)}</span>;
    if (col === 'Por qué') return <span className="muted">{p.motivoTexto || '—'}</span>;
    if (col === 'Estado') {
      // Un pago con línea del banco está resuelto porque lo dice el dinero,
      // no porque nadie lo haya elegido: para cambiarlo hay que quitarle el
      // vínculo antes, y eso se hace desde la columna LarpManager de
      // Movimientos.
      return (
        <select
          className="select-estado"
          value={p.estado || 'pendiente'}
          disabled={!!p.movimiento_id}
          onChange={e => cambiarEstado(p, e.target.value)}
        >
          {ESTADOS.map(([valor, etiqueta]) => <option key={valor} value={valor}>{etiqueta}</option>)}
        </select>
      );
    }
    if (p.movimiento_id) return <span className="vacio">—</span>;
    return (
      <button type="button" className="secundario" onClick={() => abrirPanel(p)}>
        {abierto === p.id ? 'Cerrar' : 'Vincular'}
      </button>
    );
  }

  // Panel de la fila abierta. Va a todo el ancho de la tabla a propósito: el
  // concepto del banco es lo que identifica una línea y no cabe en una celda.
  function panel(p) {
    if (!detalle) return <div className="panel-fila" style={{ width: anchoTotal }}><span className="muted">Cargando...</span></div>;

    const { candidatos, historial } = detalle;
    // Primero las líneas que llevan su nombre o su importe: son las que la
    // columna "Por qué" acaba de nombrar.
    const suyas = candidatos.filter(c => c.suNombre || c.mismoImporte);
    const todas = verTodas || suyas.length === 0;
    const lista = todas ? candidatos : suyas;

    return (
      <div className="panel-fila" style={{ width: anchoTotal }}>
        <div className="panel-bloque">
          <p className="panel-titulo">Sus pagos en LarpManager</p>
          <div className="tabla-movimientos-envoltura" role="table">
            <div role="row" className="fila-tabla-cabecera" style={{ gridTemplateColumns: '100px 150px 90px 1fr' }}>
              <Celda cabecera>Fecha</Celda>
              <Celda cabecera>Evento</Celda>
              <Celda cabecera>Importe</Celda>
              <Celda cabecera>Línea del banco</Celda>
            </div>
            {historial.map(h => (
              <div
                role="row"
                key={h.id}
                className={`fila-tabla${h.id === p.id ? ' fila-esta' : ''}`}
                style={{ gridTemplateColumns: '100px 150px 90px 1fr' }}
              >
                <Celda><span className="muted">{dia(h.fecha)}</span></Celda>
                <Celda><span className="muted">{h.evento || '—'}</span></Celda>
                <Celda>{eur(h.importe)}</Celda>
                <Celda className="envuelve">
                  {h.movimiento
                    ? `${dia(h.movimiento.fecha)} · ${eur(h.movimiento.importe)} · «${h.movimiento.concepto || ''}»`
                    : <span className="muted">{h.nota}</span>}
                </Celda>
              </div>
            ))}
          </div>
        </div>

        <div className="panel-bloque">
          <p className="panel-titulo">Elige la línea del banco</p>
          <p className="muted" style={{ margin: '0 0 4px', fontSize: 12 }}>
            {todas
              ? (suyas.length === 0
                ? `Ninguna lleva su nombre ni su importe — están las ${candidatos.length}.`
                : `Todos los ingresos (${candidatos.length}).`)
              : <>
                  {suyas.length} de {candidatos.length} llevan su nombre o su importe.{' '}
                  <a href="#" onClick={e => { e.preventDefault(); setVerTodas(true); }}>Ver todas</a>
                </>}
          </p>
          <div className="tabla-movimientos-envoltura" role="table">
            <div role="row" className="fila-tabla-cabecera" style={{ gridTemplateColumns: '100px 90px 1fr 110px 110px' }}>
              <Celda cabecera>Fecha</Celda>
              <Celda cabecera>Importe</Celda>
              <Celda cabecera>Concepto</Celda>
              <Celda cabecera>Estado</Celda>
              <Celda cabecera> </Celda>
            </div>
            {lista.map(c => (
              <div role="row" key={c.id} className="fila-tabla" style={{ gridTemplateColumns: '100px 90px 1fr 110px 110px' }}>
                <Celda><span className="muted">{dia(c.fecha)}</span></Celda>
                <Celda>{eur(c.importe)}</Celda>
                <Celda className="envuelve">{c.concepto}</Celda>
                <Celda><span className="muted">{c.estado === 'resuelta' ? 'resuelta' : c.estado || '—'}</span></Celda>
                <Celda>
                  <button type="button" className="secundario" disabled={guardando} onClick={() => vincular(p, c.id)}>
                    {guardando ? '...' : 'Es esta'}
                  </button>
                </Celda>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 12 }}>
            <button type="button" className="secundario" onClick={cerrarPanel}>Cancelar</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="bloques">
        <div className="bloque">
          <div className="btns">
            <button type="button" className="secundario btn-icono" onClick={onAbrirSubida}>
              <span className="ico">⬆</span>Subir pagos de LarpManager
            </button>
            <button type="button" className="secundario" disabled={cargando} onClick={cargar}>
              {cargando ? 'Recalculando...' : 'Recalcular'}
            </button>
          </div>
        </div>
      </div>

      <p className="muted">
        Los pagos que LarpManager da por hechos, y si su ingreso está o no en el banco. Al entrar aquí se cruzan otra
        vez, así que lo que se ve es de ahora mismo. &quot;Por qué&quot; dice qué le pasa a cada uno, y
        &quot;Vincular&quot; abre las líneas del banco para señalarla tú cuando sabes cuál es — la app aprende de esa
        vez y aplica lo aprendido al resto de pagos de esa persona. Si un pago no espera ningún ingreso, ponlo en
        &quot;ignorar&quot;. Quitando &quot;Solo pendientes&quot; salen también los que ya tienen su línea.
      </p>

      <div className="buscador-fila">
        <div className="grupo-tb">
          <input type="text" placeholder="Buscar en cualquier columna..." value={busqueda} onChange={e => setBusqueda(e.target.value)} />
        </div>
        <div className="div-v" />
        <label className="fila-checkbox">
          <input type="checkbox" checked={soloPendientes} onChange={e => setSoloPendientes(e.target.checked)} />
          Solo pendientes
        </label>
        <div className="div-v" />
        <div style={{ position: 'relative' }}>
          <button type="button" className="secundario" onClick={() => setMostrarColumnas(v => !v)}>Columnas</button>
          {mostrarColumnas && (
            <div className="panel-columnas">
              {COLUMNAS.map(c => (
                <label key={c} className="fila-checkbox">
                  <input type="checkbox" checked={columnasVisibles.has(c)} onChange={() => alternarColumna(c)} />
                  {c}
                </label>
              ))}
            </div>
          )}
        </div>
        <span className="pend" style={{ marginLeft: 'auto' }}>
          {soloPendientes
            ? `${visibles.length} sin emparejar`
            : `${visibles.length} pagos · ${(pagos || []).filter(p => p.movimiento_id).length} con su línea del banco`}
        </span>
      </div>

      {cargando && <p className="muted">Cruzando...</p>}
      {!cargando && pagos && pagos.length === 0 && (
        <p className="muted">Ninguno — todos los pagos de LarpManager tienen su línea del banco.</p>
      )}
      {!cargando && visibles.length === 0 && pagos && pagos.length > 0 && (
        <p className="muted">Nada que coincida con este filtro.</p>
      )}

      {visibles.length > 0 && (
        <div className="tabla-movimientos-envoltura" role="table">
          <div role="rowgroup">
            <div role="row" className="fila-tabla-cabecera" style={{ gridTemplateColumns: plantillaColumnas }}>
              {columnasMostradas.map(c => (
                <Celda key={c} cabecera>
                  <span className="etiqueta-orden" onClick={() => alternarOrden(c)}>
                    {c}{ordenPor?.campo === c ? (ordenPor.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                  </span>
                  <span className="resize-handle" onPointerDown={e => iniciarArrastre(e, c)} />
                </Celda>
              ))}
            </div>
          </div>
          <div role="rowgroup">
            {visibles.map(p => (
              <Fragment key={p.id}>
                <div role="row" className="fila-tabla" style={{ gridTemplateColumns: plantillaColumnas }}>
                  {columnasMostradas.map(c => (
                    <Celda key={c} className={c === 'Por qué' ? 'envuelve' : ''}>{contenido(c, p)}</Celda>
                  ))}
                </div>
                {abierto === p.id && panel(p)}
              </Fragment>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
