'use client';

import { useState, useMemo, Fragment } from 'react';
import SubirFactura from './SubirFactura';
import { apiFetch, mostrarToast } from '../lib/toast';

const ETIQUETAS = {
  fija: 'fija',
  factura_propia: 'factura propia',
  mixta: 'mixta',
  nueva: 'nueva',
};

const COLUMNAS_BASE = ['Fecha', 'Concepto', 'Proveedor', 'Importe', 'Estado', 'Nota', 'Proyecto'];
const ANCHO_DEFECTO = { Fecha: 90, Concepto: 280, Proveedor: 190, Importe: 90, Estado: 150, Nota: 190, Proyecto: 130 };
const ANCHO_EXTRA_DEFECTO = 140;

// Un movimiento separado de su grupo lleva su id como sufijo en la clave
// (ver lib/agrupador.cjs#separarDeGrupo) para que quede aparte pero el
// nombre en pantalla siga siendo el original.
function nombreGrupo(clave) {
  return (clave || '').replace(/ #\d+$/, '');
}

export default function TablaMovimientos({ trimestreId, proveedores, proyectos, onCambio }) {
  const [busqueda, setBusqueda] = useState('');
  const [soloPendientes, setSoloPendientes] = useState(true);
  const [ordenPor, setOrdenPor] = useState(null); // { campo, dir } | null (null = agrupado por proveedor)
  const [mostrarColumnas, setMostrarColumnas] = useState(false);
  const [columnasExtraVisibles, setColumnasExtraVisibles] = useState(() => new Set());
  const [notasManual, setNotasManual] = useState({});
  const [proveedoresManual, setProveedoresManual] = useState({});
  const [notasGrupo, setNotasGrupo] = useState({});
  const [mensajes, setMensajes] = useState({});
  const [ambiguos, setAmbiguos] = useState({});
  const [anchos, setAnchos] = useState({});

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

  const grupos = useMemo(() => {
    const texto = busqueda.trim().toLowerCase();
    return proveedores
      .map(g => ({
        ...g,
        importeTotal: g.movimientos.reduce((s, m) => s + Number(m.importe), 0),
        movimientos: g.movimientos.filter(m => {
          if (soloPendientes && m.estado === 'resuelta') return false;
          if (!texto) return true;
          const campos = [m.concepto, g.clave, m.nota_final, m.importe, m.fecha, ...(m.datos_originales ? Object.values(m.datos_originales) : [])];
          return campos.some(v => v !== null && v !== undefined && String(v).toLowerCase().includes(texto));
        }),
      }))
      .filter(g => g.movimientos.length > 0);
  }, [proveedores, busqueda, soloPendientes]);

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
    if (!nota) return;
    const r = await apiFetch(`/api/movimientos/${movimientoId}/confirmar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nota }),
    }, { mensajeOk: 'Guardado', mensajeError: 'No se pudo guardar.' });
    if (r) onCambio();
  }

  async function cambiarEstado(m, nuevoEstado) {
    if (nuevoEstado === 'resuelta') {
      const nota = (notasManual[m.id] ?? m.nota_final ?? '').trim();
      if (!nota) {
        mostrarToast('Escribe una nota antes de marcar como resuelta.', 'error');
        return;
      }
      await confirmarNota(m.id, nota);
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
    if (!limpia) return;
    const r = await apiFetch(`/api/trimestres/${trimestreId}/proveedores/confirmar-grupo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hoja: g.hoja, clave: g.clave, nota: limpia }),
    }, { mensajeOk: `${g.total - g.resueltas} línea(s) confirmadas`, mensajeError: 'No se pudo confirmar el grupo.' });
    if (r) onCambio();
  }

  async function cambiarEstadoGrupo(g, nuevoEstado) {
    if (nuevoEstado === 'resuelta') {
      const nota = (notasGrupo[g.id] ?? '').trim();
      if (!nota) {
        mostrarToast('Escribe una nota antes de marcar el grupo como resuelto.', 'error');
        return;
      }
      await confirmarNotaGrupo(g, nota);
      return;
    }
    if (nuevoEstado === 'pedida') {
      const r = await apiFetch(`/api/trimestres/${trimestreId}/proveedores/pendiente`, {
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

  async function separarDeGrupo(movimientoId) {
    const r = await apiFetch(`/api/movimientos/${movimientoId}/separar`, {
      method: 'POST',
    }, { mensajeOk: 'Sacado del grupo', mensajeError: 'No se pudo sacar del grupo.' });
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

  function onResultadoFactura(movimiento, resultado) {
    setMensajes(prev => ({ ...prev, [movimiento.id]: resultado.detalle }));
    if (resultado.tipo === 'match_directo') {
      onCambio();
    } else if (resultado.tipo === 'ambiguo') {
      setAmbiguos(prev => ({ ...prev, [resultado.facturaId]: resultado.candidatos.map(c => ({ ...c, numero: resultado.numero, facturaId: resultado.facturaId })) }));
    } else if (resultado.tipo === 'combo_sugerido') {
      setAmbiguos(prev => ({
        ...prev,
        [resultado.facturaId]: [{
          movimientoId: resultado.movimientoId,
          esCombo: true,
          numero: resultado.numero,
          otraFacturaNumero: resultado.otraFacturaNumero,
          facturaId: resultado.facturaId,
          otraFacturaId: resultado.otraFacturaId,
        }],
      }));
    }
  }

  async function elegirCandidato(opcion) {
    const nota = opcion.esCombo ? `${opcion.numero} + ${opcion.otraFacturaNumero}` : String(opcion.numero);
    const facturaIds = opcion.esCombo ? [opcion.facturaId, opcion.otraFacturaId] : [opcion.facturaId];
    const r = await apiFetch(`/api/movimientos/${opcion.movimientoId}/confirmar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nota, facturaIds }),
    }, { mensajeOk: 'Guardado', mensajeError: 'No se pudo guardar.' });
    if (r) onCambio();
  }

  const columnasVisiblesExtra = columnasExtra.filter(c => columnasExtraVisibles.has(c));

  function valorEstadoSelect(m) {
    if (m.estado === 'resuelta') return 'resuelta';
    if (m.estado === 'pedida_pendiente') return 'pedida';
    return 'pendiente';
  }

  function celdaNota(m, g) {
    const resuelta = m.estado === 'resuelta';
    if (resuelta) return <span className="nota-texto">{m.nota_final}</span>;
    if (g.categoria === 'factura_propia') {
      return (
        <div>
          <SubirFactura trimestreId={trimestreId} hoja={g.hoja} clave={g.clave} etiqueta="Subir factura" onResultado={r => onResultadoFactura(m, r)} />
          {mensajes[m.id] && <div className="muted" style={{ marginTop: 4, fontSize: 11 }}>{mensajes[m.id]}</div>}
          {Object.values(ambiguos).flat().filter(o => o.movimientoId === m.id).length > 0 &&
            Object.entries(ambiguos).map(([facturaId, opciones]) =>
              opciones.filter(o => o.movimientoId === m.id).map((o, i) => (
                <button key={`${facturaId}-${i}`} className="secundario" style={{ marginTop: 4, fontSize: 11, padding: '4px 8px' }} onClick={() => elegirCandidato(o)}>
                  {o.esCombo ? `Combinar con factura ${o.otraFacturaNumero}` : `Es la factura ${o.numero}`}
                </button>
              ))
            )}
        </div>
      );
    }
    const sugerencia = g.sugerenciaNota;
    const valorActual = notasManual[m.id] ?? (sugerencia || '');
    const prellenado = !notasManual[m.id] && !!sugerencia;
    return (
      <input
        className={`campo-nota${prellenado ? ' prellenado' : ''}`}
        type="text"
        placeholder="Nota..."
        value={valorActual}
        onChange={e => setNotasManual(prev => ({ ...prev, [m.id]: e.target.value }))}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); confirmarNota(m.id, e.target.value); } }}
      />
    );
  }

  function celdaEstado(m) {
    const facturaIds = m.factura_ids || [];
    return (
      <div className="celda-estado">
        <select className="select-estado" value={valorEstadoSelect(m)} onChange={e => cambiarEstado(m, e.target.value)}>
          <option value="pendiente">pendiente</option>
          <option value="pedida">pedida</option>
          <option value="resuelta">resuelta</option>
        </select>
        {m.estado === 'resuelta' && facturaIds.length > 0 && (
          <a className="link-factura" href={`/api/facturas/${facturaIds[0]}/archivo`} target="_blank" rel="noreferrer">
            ver factura{facturaIds.length > 1 ? 's' : ''}
          </a>
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
            ¿{m.proyecto_sugerido.nombre}?
          </button>
        )}
      </>
    );
  }

  function filaMovimiento(m, g) {
    return (
      <tr key={m.id}>
        <td className="fija col-fecha muted">{m.fecha ? new Date(m.fecha).toLocaleDateString('es-ES') : ''}</td>
        <td className="fija col-concepto concepto">{m.concepto?.slice(0, 80)}</td>
        <td className="proveedor">
          <input
            className={`campo-proveedor${!proveedoresManual[m.id] && !m.proveedor && m.proveedor_sugerido ? ' prellenado' : ''}`}
            type="text"
            placeholder="Proveedor..."
            value={proveedoresManual[m.id] ?? (m.proveedor || m.proveedor_sugerido || '')}
            onChange={e => setProveedoresManual(prev => ({ ...prev, [m.id]: e.target.value }))}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); guardarProveedor(m.id, e.target.value); } }}
          />
          {g.total > 1 && (
            <button type="button" className="quitar-grupo" onClick={() => separarDeGrupo(m.id)} title="Sacar esta línea del grupo, que quede aparte">
              sacar del grupo
            </button>
          )}
        </td>
        <td className="importe col-importe num">{Number(m.importe).toFixed(2)}€</td>
        <td>{celdaEstado(m)}</td>
        <td>{celdaNota(m, g)}</td>
        <td>{celdaProyecto(m)}</td>
        {columnasVisiblesExtra.map(c => (
          <td key={c} className="muted">{m.datos_originales?.[c] ?? <span className="vacio">—</span>}</td>
        ))}
      </tr>
    );
  }

  function filaGrupo(g) {
    // Solo se agrupa visualmente cuando hay mas de una linea de verdad (contando el
    // total real del grupo, no lo que quede tras filtrar).
    if (g.total <= 1) return null;
    const pendientesGrupo = g.total - g.resueltas;
    const permiteAccionesGrupo = g.categoria !== 'factura_propia' && pendientesGrupo > 0;
    return (
      <tr className="fila-grupo" key={`g-${g.id}`}>
        <td className="fija col-fecha" />
        <td className="fija col-concepto">
          <div className="grupo-nombre">{nombreGrupo(g.clave)} <span className="categoria-texto">· {ETIQUETAS[g.categoria]}</span></div>
          <div className="meta">{g.resueltas} de {g.total} resueltas</div>
        </td>
        <td />
        <td className="col-importe num">{g.importeTotal.toFixed(2)}€</td>
        <td>
          {permiteAccionesGrupo && (
            <select className="select-estado" defaultValue="" onChange={e => { if (e.target.value) cambiarEstadoGrupo(g, e.target.value); e.target.value = ''; }}>
              <option value="" disabled>estado...</option>
              <option value="pedida">pedida</option>
              <option value="resuelta">resuelta</option>
            </select>
          )}
        </td>
        <td>
          {permiteAccionesGrupo && (
            <>
              {g.sugerenciaNota && (
                <button type="button" className="chip-sugerencia" onClick={() => confirmarNotaGrupo(g, g.sugerenciaNota)}>
                  ¿Aplicar &quot;{g.sugerenciaNota}&quot; a las {pendientesGrupo}?
                </button>
              )}
              <input
                className="campo-nota"
                type="text"
                placeholder={g.sugerenciaNota ? 'o algo distinto...' : `Nota para las ${pendientesGrupo}...`}
                value={notasGrupo[g.id] || ''}
                onChange={e => setNotasGrupo(prev => ({ ...prev, [g.id]: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); confirmarNotaGrupo(g, e.target.value); } }}
              />
            </>
          )}
        </td>
        <td />
        {columnasVisiblesExtra.map(c => <td key={c} />)}
      </tr>
    );
  }

  return (
    <div>
      <div className="buscador-fila">
        <input type="text" placeholder="Buscar en cualquier columna..." value={busqueda} onChange={e => setBusqueda(e.target.value)} />
        <label className="toggle-pendientes">
          <input type="checkbox" checked={soloPendientes} onChange={e => setSoloPendientes(e.target.checked)} />
          Solo pendientes
        </label>
        <div style={{ position: 'relative' }}>
          <button className="secundario" onClick={() => setMostrarColumnas(v => !v)}>Columnas</button>
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
      </div>

      {grupos.length === 0 && <p className="muted">Nada que coincida con este filtro.</p>}

      <div className="tabla-movimientos-envoltura" style={{ '--ancho-fecha': `${anchoDe('Fecha')}px` }}>
        <table style={{ tableLayout: 'fixed' }}>
          <colgroup>
            {COLUMNAS_BASE.map(c => <col key={c} style={{ width: anchoDe(c) }} />)}
            {columnasVisiblesExtra.map(c => <col key={c} style={{ width: anchoDe(c) }} />)}
          </colgroup>
          <thead>
            <tr>
              {COLUMNAS_BASE.map(c => (
                <th
                  key={c}
                  className={[
                    c === 'Importe' ? 'col-importe' : '',
                    c === 'Fecha' ? 'fija col-fecha' : '',
                    c === 'Concepto' ? 'fija col-concepto th-concepto' : '',
                  ].join(' ').trim()}
                >
                  <span className="etiqueta-orden" onClick={() => alternarOrden(c)}>
                    {c}{ordenPor?.campo === c ? (ordenPor.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                  </span>
                  <span className="resize-handle" onPointerDown={e => iniciarArrastre(e, c)} />
                </th>
              ))}
              {columnasVisiblesExtra.map(c => (
                <th key={c}>
                  <span className="etiqueta-orden" onClick={() => alternarOrden(c)}>
                    {c}{ordenPor?.campo === c ? (ordenPor.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                  </span>
                  <span className="resize-handle" onPointerDown={e => iniciarArrastre(e, c)} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ordenPor
              ? filasOrdenadas.map(({ m, g }) => filaMovimiento(m, g))
              : grupos.map(g => (
                  <Fragment key={g.id}>
                    {filaGrupo(g)}
                    {g.movimientos.map(m => filaMovimiento(m, g))}
                  </Fragment>
                ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
