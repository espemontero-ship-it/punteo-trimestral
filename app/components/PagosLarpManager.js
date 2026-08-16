'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { apiFetch, mostrarToast } from '../lib/toast';
import { useAnchosPersistidos } from '../lib/useAnchosPersistidos';

// Mismo motor de tabla que Movimientos y Facturas (CSS Grid, no <table>): una
// plantilla de anchos que se aplica a la cabecera y a cada fila, así que es
// imposible que se desalineen. Ver PROYECTO.md, "Toda lista de datos con
// columnas es una tabla de verdad".
const COLUMNAS = ['Nombre', 'Evento', 'Importe', 'Fecha', 'Por qué', 'Vincular'];
const ANCHO_DEFECTO = { Nombre: 200, Evento: 150, Importe: 90, Fecha: 95, 'Por qué': 460, Vincular: 230 };

// Fuera del componente a propósito: si se define dentro, React la trata como
// un tipo nuevo en cada render y los <select> de dentro pierden el foco.
function Celda({ className = '', cabecera, children, style }) {
  return (
    <div role={cabecera ? 'columnheader' : 'cell'} className={`celda ${className}`.trim()} style={style}>
      {children}
    </div>
  );
}

export default function PagosLarpManager({ onAbrirSubida, onCambio }) {
  const [pagos, setPagos] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [busqueda, setBusqueda] = useState('');
  const [ordenPor, setOrdenPor] = useState(null);           // { campo, dir } | null
  const [anchos, setAnchos] = useAnchosPersistidos('punteo-anchos-larpmanager');
  const [mostrarColumnas, setMostrarColumnas] = useState(false);
  const [columnasVisibles, setColumnasVisibles] = useState(() => new Set(COLUMNAS));
  // Vincular a mano: qué fila está abierta y con qué candidatas.
  const [vinculando, setVinculando] = useState(null);
  const [candidatos, setCandidatos] = useState(null);
  const [lineaElegida, setLineaElegida] = useState('');
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
    return '';
  };

  const visibles = useMemo(() => {
    let lista = pagos || [];
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
  }, [pagos, busqueda, ordenPor]);

  async function abrirVinculo(p) {
    setVinculando(p.id);
    setCandidatos(null);
    setLineaElegida('');
    setVerTodas(false);
    const data = await apiFetch(`/api/larpmanager-pagos/${p.id}/candidatos`, undefined, {
      mensajeError: 'No se pudieron cargar las líneas del banco.',
    });
    setCandidatos((data && data.candidatos) || []);
  }

  function cerrarVinculo() {
    setVinculando(null);
    setCandidatos(null);
    setLineaElegida('');
  }

  async function vincular(p) {
    if (!lineaElegida) return;
    setGuardando(true);
    const r = await apiFetch(`/api/larpmanager-pagos/${p.id}/vincular`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ movimientoId: lineaElegida }),
    }, { mensajeOk: 'Vinculado', mensajeError: 'No se pudo vincular.' });
    setGuardando(false);
    if (r) {
      if (r.aprendidas > 0) mostrarToast(`Aprendido cómo lo llama el banco: se aplicará a sus demás pagos.`, 'ok');
      cerrarVinculo();
      await cargar();
      if (onCambio) onCambio();
    }
  }

  const columnasMostradas = COLUMNAS.filter(c => columnasVisibles.has(c));
  const plantillaColumnas = columnasMostradas.map(c => `${anchoDe(c)}px`).join(' ');

  function contenido(col, p) {
    if (col === 'Nombre') return p.nombre_real;
    if (col === 'Evento') return <span className="muted">{p.evento || '—'}</span>;
    if (col === 'Importe') return <span className="num">{Number(p.importe).toFixed(2)}€</span>;
    if (col === 'Fecha') return <span className="muted">{p.fecha ? new Date(p.fecha).toLocaleDateString('es-ES') : '—'}</span>;
    if (col === 'Por qué') return <span className="muted" style={{ whiteSpace: 'normal' }}>{p.motivoTexto || '—'}</span>;

    if (vinculando !== p.id) {
      return <button type="button" className="secundario" onClick={() => abrirVinculo(p)}>Vincular</button>;
    }
    if (candidatos === null) return <span className="muted">Cargando...</span>;

    // Primero las líneas que llevan su nombre o su importe: son las que la
    // columna "Por qué" acaba de nombrar.
    const suyas = candidatos.filter(c => c.suNombre || c.mismoImporte);
    const resto = candidatos.filter(c => !c.suNombre && !c.mismoImporte);
    const todas = verTodas || suyas.length === 0;
    const lista = todas ? candidatos : suyas;
    return (
      <div>
        <select value={lineaElegida} onChange={e => setLineaElegida(e.target.value)} style={{ width: '100%' }}>
          <option value="">Elige línea del banco...</option>
          {lista.map(c => (
            <option key={c.id} value={c.id}>
              {c.fecha ? new Date(c.fecha).toLocaleDateString('es-ES') : 'sin fecha'} · {c.importe.toFixed(2)}€ · {c.concepto}
            </option>
          ))}
        </select>
        <p className="muted" style={{ margin: '4px 0 0', fontSize: 11, whiteSpace: 'normal' }}>
          {todas
            ? (suyas.length === 0 ? 'Ninguna lleva su nombre ni su importe — están todas.' : `Todos los ingresos (${candidatos.length}).`)
            : `${suyas.length} de ${candidatos.length} llevan su nombre o su importe.`}
          {!todas && resto.length > 0 && (
            <> <a href="#" onClick={e => { e.preventDefault(); setVerTodas(true); }}>Ver todas</a></>
          )}
        </p>
        <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
          <button type="button" className="secundario" disabled={!lineaElegida || guardando} onClick={() => vincular(p)}>
            {guardando ? '...' : 'Vincular'}
          </button>
          <button type="button" className="secundario" onClick={cerrarVinculo}>Cancelar</button>
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
        Pagos que LarpManager da por hechos y que no tienen su ingreso en el banco. Al entrar aquí se cruzan otra vez,
        así que esto es lo que hace falta mirar a mano. &quot;Por qué&quot; dice qué le pasa a cada uno, y
        &quot;Vincular&quot; sirve para señalar tú la línea cuando sabes cuál es — la app aprende de esa vez y aplica
        lo aprendido al resto de pagos de esa persona.
      </p>

      <div className="buscador-fila">
        <div className="grupo-tb">
          <input type="text" placeholder="Buscar en cualquier columna..." value={busqueda} onChange={e => setBusqueda(e.target.value)} />
        </div>
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
          {visibles.length} sin emparejar
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
              <div role="row" key={p.id} className="fila-tabla" style={{ gridTemplateColumns: plantillaColumnas }}>
                {columnasMostradas.map(c => (
                  <Celda key={c}>{contenido(c, p)}</Celda>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
