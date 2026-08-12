'use client';

import { useEffect, useMemo, useState } from 'react';
import { ConfirmDialog } from './ConfirmDialog';
import { apiFetch, mostrarToast } from '../lib/toast';

const ETIQUETAS_TIPO = {
  match_directo: 'Emparejada',
  ambiguo: 'Varias líneas con el mismo importe',
  combo_sugerido: 'Combinación de 2 facturas sugerida',
  sin_importe: 'No se reconoció ningún importe',
  sin_match: 'Importe no coincide con ninguna línea',
  sin_movimientos: 'Aún no hay movimientos con los que comparar',
  imagen_sin_texto: 'Es una imagen, no se puede leer',
  error: 'Error al procesar el archivo',
};

// Mismo motor de columnas que TablaMovimientos.js (CSS Grid, no <table>): una
// única plantilla de anchos se aplica a la cabecera y a cada fila, así que es
// estructuralmente imposible que se desalineen, y cada columna tiene su
// propio sitio fijo — nada se mete a compartir celda con otra cosa.
const COLUMNAS = ['Archivo', 'Concepto', 'Ver', 'Motivo', 'Vincular', 'Movimiento', 'Fecha', 'Importe', 'Subida', 'Buscar'];
const ANCHO_DEFECTO = { Archivo: 220, Concepto: 160, Ver: 40, Motivo: 220, Vincular: 210, Movimiento: 240, Fecha: 130, Importe: 90, Subida: 150, Buscar: 90 };
const ANCHO_CHECKBOX = 30;

// Por debajo de este ancho la cuadrícula deja de caber (aunque el
// contenedor sea ancho) -- se pinta como tarjetas apiladas en su lugar.
const ANCHO_MOVIL = 768;

function montoCaracteristico(f) {
  if (f.totales && f.totales.length) return Math.max(...f.totales.map(Number));
  if (f.importes && f.importes.length) return Math.max(...f.importes.map(Number));
  return null;
}

function importeInicial(f) {
  const monto = montoCaracteristico(f);
  return monto !== null ? String(monto).replace('.', ',') : '';
}

function fechaInicial(f) {
  return f.fechas && f.fechas[0] ? String(f.fechas[0]).slice(0, 10) : '';
}

// Fuera del componente a propósito: si se define dentro, React la trata como
// un tipo de componente nuevo en cada render y desmonta/remonta todo lo de
// dentro -- incluidos los <input>, que pierden el foco en cada tecla.
function Celda({ className = '', cabecera, children, style }) {
  return (
    <div role={cabecera ? 'columnheader' : 'cell'} className={`celda ${className}`.trim()} style={style}>
      {children}
    </div>
  );
}

export default function FacturasTrimestre({ facturas, onCambio }) {
  const [seleccionadas, setSeleccionadas] = useState(new Set());
  const [confirmarBorrado, setConfirmarBorrado] = useState(false);
  const [borrando, setBorrando] = useState(false);
  const [progresoRecalculo, setProgresoRecalculo] = useState(null); // { actual, total } | null
  const [progresoIA, setProgresoIA] = useState(null); // { actual, total } | null
  const [edicionImporte, setEdicionImporte] = useState({});
  const [edicionFecha, setEdicionFecha] = useState({});
  const [buscando, setBuscando] = useState(new Set());
  const [resultadosFila, setResultadosFila] = useState({}); // { [facturaId]: resultado } — sobreescribe el motivo guardado hasta recargar
  const [movimientosPendientes, setMovimientosPendientes] = useState([]);
  const [vinculandoManual, setVinculandoManual] = useState(new Set());
  const [movimientoElegido, setMovimientoElegido] = useState({});
  const [vinculando, setVinculando] = useState(new Set());
  const [soloPendientes, setSoloPendientes] = useState(true);
  const [anchos, setAnchos] = useState({});
  const [mostrarColumnas, setMostrarColumnas] = useState(false);
  const [columnasVisibles, setColumnasVisibles] = useState(() => new Set(COLUMNAS));
  const [esMovil, setEsMovil] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${ANCHO_MOVIL}px)`);
    setEsMovil(mq.matches);
    const onChange = e => setEsMovil(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  function anchoDe(col) {
    return anchos[col] ?? ANCHO_DEFECTO[col] ?? 140;
  }

  // Ver iniciarArrastre en TablaMovimientos.js para la explicación de por qué
  // se escucha en window y por qué el try/catch alrededor de setPointerCapture.
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

  function alternarColumna(col) {
    setColumnasVisibles(prev => {
      const next = new Set(prev);
      if (next.has(col)) next.delete(col); else next.add(col);
      return next;
    });
  }

  // Lista de movimientos pendientes para poder vincular una factura a mano
  // cuando ya se sabe cuál es, sin depender de que el importe/fecha encajen
  // solos (ej. facturas con varios importes dentro de un mismo archivo).
  useEffect(() => {
    let cancelado = false;
    apiFetch(`/api/movimientos-pendientes`, undefined, {
      mensajeError: 'No se pudo cargar la lista de movimientos.',
    }).then(r => { if (!cancelado && r) setMovimientosPendientes(r.movimientos || []); });
    return () => { cancelado = true; };
  }, []);

  const sinResolver = useMemo(() => facturas.filter(f => f.estado !== 'matcheada').length, [facturas]);
  const sinImporte = useMemo(
    () => facturas.filter(f => f.estado !== 'matcheada' && !(f.totales?.length || f.importes?.length)).length,
    [facturas]
  );

  // Un archivo a la vez (no un único POST largo) para poder mostrar progreso
  // real y para no arriesgarse a que el servidor corte una petición muy larga
  // a mitad si hay muchas facturas pendientes.
  async function recalcular() {
    const r = await apiFetch(`/api/recalcular-facturas`, undefined, {
      mensajeError: 'No se pudo obtener la lista de facturas pendientes.',
    });
    if (!r || r.ids.length === 0) return;

    let resueltas = 0;
    for (let i = 0; i < r.ids.length; i++) {
      setProgresoRecalculo({ actual: i + 1, total: r.ids.length });
      try {
        const res = await fetch(`/api/facturas/${r.ids[i]}/reprocesar`, { method: 'POST' });
        const resultado = await res.json();
        if (resultado.tipo === 'match_directo') resueltas++;
      } catch {
        // un archivo suelto que falle no debe frenar el resto de la lista
      }
    }

    setProgresoRecalculo(null);
    mostrarToast(`${resueltas} de ${r.ids.length} factura(s) emparejadas`, 'ok');
    onCambio();
  }

  // Aparte de recalcular() (regex, gratis): esto le pasa a una IA las
  // facturas que se quedaron sin ningún importe reconocido (imágenes, PDFs
  // ilegibles) — tiene un coste pequeño por factura, así que es un botón
  // aparte que se activa a mano después de haber probado ya el recálculo
  // normal, no algo automático.
  async function leerConIA() {
    const r = await apiFetch(`/api/facturas-sin-importe`, undefined, {
      mensajeError: 'No se pudo obtener la lista de facturas sin importe.',
    });
    if (!r || r.ids.length === 0) return;

    let resueltas = 0;
    for (let i = 0; i < r.ids.length; i++) {
      setProgresoIA({ actual: i + 1, total: r.ids.length });
      try {
        const res = await fetch(`/api/facturas/${r.ids[i]}/leer-ia`, { method: 'POST' });
        const resultado = await res.json();
        if (resultado.tipo === 'match_directo') resueltas++;
      } catch {
        // una factura suelta que falle no debe frenar el resto de la lista
      }
    }

    setProgresoIA(null);
    mostrarToast(`${resueltas} de ${r.ids.length} factura(s) emparejadas con IA`, 'ok');
    onCambio();
  }

  function descargarInformeCsv() {
    const pendientes = facturas.filter(f => f.estado !== 'matcheada');
    if (pendientes.length === 0) return;
    const escapar = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const filas = [
      ['Archivo', 'Motivo', 'Detalle'].map(escapar).join(','),
      ...pendientes.map(f => [f.nombre_original, ETIQUETAS_TIPO[f.motivo_tipo] || f.motivo_tipo || '', f.motivo_detalle].map(escapar).join(',')),
    ];
    const blob = new Blob(['﻿' + filas.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `facturas-sin-resolver-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Guarda importe/fecha (si se han tocado) y relanza el matching -- si hay
  // varias líneas con el mismo importe o se sugiere una combinación, la fila
  // se expande para elegir a mano en vez de quedarse sin más.
  async function buscarFila(f) {
    const importeTexto = (edicionImporte[f.id] ?? importeInicial(f)).replace(',', '.').trim();
    const importe = importeTexto ? Number(importeTexto) : null;
    const fecha = edicionFecha[f.id] ?? fechaInicial(f) ?? null;

    setBuscando(prev => new Set(prev).add(f.id));
    let resultado;
    try {
      const res = await fetch(`/api/facturas/${f.id}/datos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ importe, fecha: fecha || null }),
      });
      resultado = await res.json();
    } catch (err) {
      resultado = { tipo: 'error', detalle: err.message };
    }
    setBuscando(prev => { const next = new Set(prev); next.delete(f.id); return next; });
    setResultadosFila(prev => ({ ...prev, [f.id]: resultado }));
    if (resultado.tipo === 'match_directo') {
      mostrarToast('Emparejada', 'ok');
      onCambio();
    }
  }

  async function elegirCandidato(f, opcion) {
    const nota = opcion.esCombo ? `${opcion.numero} + ${opcion.otraFacturaNumero}` : (opcion.facturaConcepto || String(opcion.numero));
    const facturaIds = opcion.esCombo ? [opcion.facturaId, opcion.otraFacturaId] : [opcion.facturaId];
    const r = await apiFetch(`/api/movimientos/${opcion.movimientoId}/confirmar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nota, facturaIds }),
    }, { mensajeOk: 'Guardado', mensajeError: 'No se pudo guardar.' });
    if (r) {
      setResultadosFila(prev => { const next = { ...prev }; delete next[f.id]; return next; });
      onCambio();
    }
  }

  function alternarVinculoManual(facturaId) {
    setVinculandoManual(prev => {
      const next = new Set(prev);
      if (next.has(facturaId)) next.delete(facturaId); else next.add(facturaId);
      return next;
    });
  }

  async function vincularManual(f) {
    const movimientoId = movimientoElegido[f.id];
    if (!movimientoId) return;
    setVinculando(prev => new Set(prev).add(f.id));
    const r = await apiFetch(`/api/movimientos/${movimientoId}/confirmar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nota: f.concepto || String(f.numero), facturaIds: [f.id] }),
    }, { mensajeOk: 'Vinculada', mensajeError: 'No se pudo vincular.' });
    setVinculando(prev => { const next = new Set(prev); next.delete(f.id); return next; });
    if (r) {
      setVinculandoManual(prev => { const next = new Set(prev); next.delete(f.id); return next; });
      onCambio();
    }
  }

  const seleccionadasEmparejadas = useMemo(
    () => facturas.filter(f => seleccionadas.has(f.id) && f.estado === 'matcheada').length,
    [facturas, seleccionadas]
  );

  const nombresDuplicados = useMemo(() => {
    const conteo = {};
    for (const f of facturas) {
      if (!f.nombre_original) continue;
      conteo[f.nombre_original] = (conteo[f.nombre_original] || 0) + 1;
    }
    return new Set(Object.keys(conteo).filter(n => conteo[n] > 1));
  }, [facturas]);

  function alternar(id) {
    setSeleccionadas(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // Solo actúa sobre las filas visibles (si "solo pendientes" oculta las
  // emparejadas, "seleccionar todas" no debe intentar marcar filas que no se ven).
  function alternarTodas(facturasVisibles) {
    setSeleccionadas(prev => (prev.size === facturasVisibles.length ? new Set() : new Set(facturasVisibles.map(f => f.id))));
  }

  // Por cada nombre repetido: si alguna copia ya está emparejada, todas las
  // demás sobran (ya hay una buena). Si ninguna está emparejada, se marcan
  // todas menos la más antigua -- el objetivo es quedarse con una copia, no
  // borrar el archivo entero si nunca llegó a emparejar ninguna.
  const duplicadasSinEmparejar = useMemo(() => {
    const porNombre = {};
    for (const f of facturas) {
      if (!nombresDuplicados.has(f.nombre_original)) continue;
      (porNombre[f.nombre_original] ||= []).push(f);
    }
    const resultado = [];
    for (const grupo of Object.values(porNombre)) {
      const sinEmparejar = grupo.filter(f => f.estado !== 'matcheada');
      const hayEmparejada = sinEmparejar.length < grupo.length;
      if (hayEmparejada) {
        resultado.push(...sinEmparejar);
      } else {
        const ordenado = [...sinEmparejar].sort((a, b) => new Date(a.creado_en) - new Date(b.creado_en));
        resultado.push(...ordenado.slice(1));
      }
    }
    return resultado;
  }, [facturas, nombresDuplicados]);

  function marcarDuplicadasSinEmparejar() {
    setSeleccionadas(new Set(duplicadasSinEmparejar.map(f => f.id)));
  }

  async function borrarSeleccionadas() {
    setConfirmarBorrado(false);
    setBorrando(true);
    const r = await apiFetch(`/api/facturas`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [...seleccionadas] }),
    }, { mensajeOk: 'Facturas borradas', mensajeError: 'No se pudieron borrar.' });
    setBorrando(false);
    if (r) {
      setSeleccionadas(new Set());
      onCambio();
    }
  }

  if (facturas.length === 0) {
    return <p className="muted">Todavía no se ha subido ninguna factura suelta a este trimestre.</p>;
  }

  const columnasMostradas = COLUMNAS.filter(c => columnasVisibles.has(c));
  const plantillaColumnas = [`${ANCHO_CHECKBOX}px`, ...columnasMostradas.map(c => `${anchoDe(c)}px`)].join(' ');
  const facturasVisibles = soloPendientes ? facturas.filter(f => f.estado !== 'matcheada') : facturas;

  function contenidoCelda(col, f) {
    const duplicada = nombresDuplicados.has(f.nombre_original);
    const resultadoLocal = resultadosFila[f.id];
    // Si no se acaba de recalcular esta fila a mano en esta sesión (resultadoLocal),
    // cae a lo que ya se calculó y se guardó en BD la última vez (subida de excel,
    // "Recalcular facturas sin resolver"...) -- si no, los botones para elegir
    // candidato solo aparecerían tras pulsar "Buscar" fila a fila, aunque el
    // cruce ya estuviera hecho. Ver candidatosParaGuardar en facturaMatcher.cjs.
    const persistido = !resultadoLocal && f.estado !== 'matcheada' && f.motivo_candidatos
      ? { tipo: f.motivo_tipo, numero: f.numero, facturaConcepto: f.concepto, detalle: f.motivo_detalle, ...f.motivo_candidatos }
      : null;
    const activo = resultadoLocal || persistido;
    const candidatos = activo?.tipo === 'ambiguo' ? activo.candidatos.map(c => ({
      movimientoId: c.movimientoId, numero: activo.numero, facturaId: f.id, facturaConcepto: activo.facturaConcepto,
      concepto: c.concepto, importe: c.importe, fecha: c.fecha,
    })) : activo?.tipo === 'combo_sugerido' ? [{
      movimientoId: activo.movimientoId, esCombo: true, numero: activo.numero,
      otraFacturaNumero: activo.otraFacturaNumero, facturaId: f.id, otraFacturaId: activo.otraFacturaId,
      facturaConcepto: activo.facturaConcepto, detalle: activo.detalle,
    }] : null;
    const bloqueada = f.estado === 'matcheada' || !!candidatos;

    switch (col) {
      case 'Archivo':
        return <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{f.nombre_original}{duplicada ? ' ⚠' : ''}</span>;

      case 'Concepto':
        return f.concepto ? <span>{f.concepto}</span> : <span className="vacio">—</span>;

      case 'Subida':
        return (
          <span className="muted" style={{ fontSize: 11.5, whiteSpace: 'normal' }}>
            {new Date(f.creado_en).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
            {f.subido_por_nombre ? <><br />{f.subido_por_nombre}</> : null}
          </span>
        );

      case 'Ver':
        return <a className="link-factura" href={`/api/facturas/${f.id}/archivo`} target="_blank" rel="noreferrer">ver</a>;

      case 'Motivo':
        if (candidatos) {
          return (
            <div>
              <p className="muted" style={{ margin: '0 0 4px', fontSize: 11 }}>
                {activo.tipo === 'ambiguo' ? `${candidatos.length} líneas con el mismo importe — elige cuál es:` : 'Combinación sugerida — confirma si es correcta:'}
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {candidatos.map((c, i) => (
                  <div key={i}>
                    <button type="button" className="secundario" style={{ textAlign: 'left', padding: '6px 10px', display: 'block', width: '100%' }} onClick={() => elegirCandidato(f, c)}>
                      {c.esCombo ? (
                        <div className="muted" style={{ fontSize: 11, whiteSpace: 'normal' }}>{c.detalle}</div>
                      ) : (
                        <>
                          <div style={{ fontSize: 12, fontWeight: 600 }}>
                            {c.fecha ? new Date(c.fecha).toLocaleDateString('es-ES') : 'sin fecha'} · {Number(c.importe).toFixed(2)}€
                          </div>
                          <div className="muted" style={{ fontSize: 11, marginTop: 2, whiteSpace: 'normal' }}>{c.concepto}</div>
                        </>
                      )}
                    </button>
                    {c.esCombo && (
                      <a className="link-factura" style={{ fontSize: 11 }} href={`/api/facturas/${c.otraFacturaId}/archivo`} target="_blank" rel="noreferrer">
                        ver factura {c.otraFacturaNumero}
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        }
        return <span className="muted">{f.estado === 'matcheada' ? 'Emparejada' : (ETIQUETAS_TIPO[(resultadoLocal || f).motivo_tipo || resultadoLocal?.tipo] || (resultadoLocal || f).motivo_detalle || 'Sin recalcular todavía')}</span>;

      case 'Vincular':
        if (bloqueada) return <span className="muted">—</span>;
        if (!vinculandoManual.has(f.id)) {
          return <button type="button" className="secundario" style={{ fontSize: 11, padding: '4px 8px' }} onClick={() => alternarVinculoManual(f.id)}>vincular a mano</button>;
        }
        return (
          <div>
            <select
              value={movimientoElegido[f.id] || ''}
              onChange={e => setMovimientoElegido(prev => ({ ...prev, [f.id]: e.target.value }))}
              style={{ fontSize: 11.5, padding: '4px 6px', width: '100%' }}
            >
              <option value="">Elige línea del banco...</option>
              {movimientosPendientes.map(m => (
                <option key={m.id} value={m.id}>
                  {m.fecha ? new Date(m.fecha).toLocaleDateString('es-ES') : ''} · {Number(m.importe).toFixed(2)}€ · {m.concepto?.slice(0, 40)}
                </option>
              ))}
            </select>
            <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
              <button type="button" className="secundario" style={{ fontSize: 11, padding: '4px 8px' }} disabled={!movimientoElegido[f.id] || vinculando.has(f.id)} onClick={() => vincularManual(f)}>
                {vinculando.has(f.id) ? '...' : 'Vincular'}
              </button>
              <button type="button" className="secundario" style={{ fontSize: 11, padding: '4px 8px' }} onClick={() => alternarVinculoManual(f.id)}>
                Cancelar
              </button>
            </div>
          </div>
        );

      case 'Movimiento':
        return (
          <span className="muted">
            {f.estado === 'matcheada'
              ? `${f.movimiento_fecha ? new Date(f.movimiento_fecha).toLocaleDateString('es-ES') + ' · ' : ''}${f.movimiento_concepto?.slice(0, 40) || ''} · ${f.movimiento_importe !== undefined && f.movimiento_importe !== null ? `${Number(f.movimiento_importe).toFixed(2)}€` : ''}`
              : '—'}
          </span>
        );

      case 'Fecha':
        if (bloqueada) return <span className="muted">—</span>;
        return (
          <input
            type="date"
            value={edicionFecha[f.id] ?? fechaInicial(f)}
            onChange={e => setEdicionFecha(prev => ({ ...prev, [f.id]: e.target.value }))}
            style={{ fontSize: 12, padding: '5px 6px', width: '100%' }}
          />
        );

      case 'Importe':
        if (bloqueada) return <span className="muted">—</span>;
        return (
          <input
            type="text"
            inputMode="decimal"
            placeholder="0,00"
            value={edicionImporte[f.id] ?? importeInicial(f)}
            onChange={e => setEdicionImporte(prev => ({ ...prev, [f.id]: e.target.value }))}
            style={{ fontSize: 12, padding: '5px 6px', width: '100%' }}
          />
        );

      case 'Buscar':
        if (bloqueada) return null;
        return (
          <button type="button" className="secundario" style={{ fontSize: 11, padding: '4px 8px' }} disabled={buscando.has(f.id)} onClick={() => buscarFila(f)}>
            {buscando.has(f.id) ? '...' : 'Buscar'}
          </button>
        );

      default:
        return null;
    }
  }

  return (
    <div>
      <div className="fila" style={{ marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <p className="muted" style={{ margin: 0 }}>
          {sinResolver} factura(s) sin resolver todavía.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <label className="toggle-pendientes">
            <input type="checkbox" checked={soloPendientes} onChange={e => setSoloPendientes(e.target.checked)} />
            Solo pendientes
          </label>
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
          <button type="button" className="secundario" onClick={descargarInformeCsv} disabled={sinResolver === 0}>
            Descargar CSV
          </button>
          <button type="button" className="secundario" disabled={sinResolver === 0 || !!progresoRecalculo} onClick={recalcular}>
            {progresoRecalculo ? `Recalculando ${progresoRecalculo.actual} de ${progresoRecalculo.total}...` : 'Recalcular facturas sin resolver'}
          </button>
          <button type="button" className="secundario" disabled={sinImporte === 0 || !!progresoIA} onClick={leerConIA} title="Usa IA para leer imágenes/PDFs ilegibles — tiene un coste pequeño por factura">
            {progresoIA ? `Leyendo ${progresoIA.actual} de ${progresoIA.total}...` : `Leer con IA (${sinImporte})`}
          </button>
        </div>
      </div>
      {progresoRecalculo && (
        <div className="progreso" style={{ margin: '0 0 12px' }}>
          <div style={{ width: `${(progresoRecalculo.actual / progresoRecalculo.total) * 100}%` }} />
        </div>
      )}
      {progresoIA && (
        <div className="progreso" style={{ margin: '0 0 12px' }}>
          <div style={{ width: `${(progresoIA.actual / progresoIA.total) * 100}%` }} />
        </div>
      )}
      {nombresDuplicados.size > 0 && (
        <div className="fila" style={{ marginBottom: 8 }}>
          <p className="muted" style={{ fontWeight: 700, margin: 0 }}>
            ⚠ {nombresDuplicados.size} nombre(s) de archivo repetido(s) — marcados abajo.
          </p>
          <button type="button" className="secundario" disabled={duplicadasSinEmparejar.length === 0} onClick={marcarDuplicadasSinEmparejar}>
            Marcar duplicadas sin emparejar ({duplicadasSinEmparejar.length})
          </button>
        </div>
      )}

      {esMovil ? (
        <div className="lista-facturas-movil">
          {facturasVisibles.map(f => {
            const duplicada = nombresDuplicados.has(f.nombre_original);
            return (
              <div key={f.id} className="tarjeta tarjeta-factura-movil" style={{ background: duplicada ? 'rgba(166, 124, 46, 0.08)' : undefined }}>
                <label className="fila" style={{ marginBottom: 8 }}>
                  <span style={{ fontWeight: 600 }}>{f.nombre_original}{duplicada ? ' ⚠' : ''}</span>
                  <input type="checkbox" checked={seleccionadas.has(f.id)} onChange={() => alternar(f.id)} />
                </label>
                {columnasMostradas.filter(c => c !== 'Archivo').map(c => (
                  <div key={c} className="campo-factura-movil">
                    <span className="muted campo-factura-movil-etiqueta">{c}</span>
                    <div>{contenidoCelda(c, f)}</div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="tabla-movimientos-envoltura" role="table">
          <div role="rowgroup">
            <div role="row" className="fila-tabla-cabecera" style={{ gridTemplateColumns: plantillaColumnas }}>
              <Celda cabecera>
                <input type="checkbox" checked={facturasVisibles.length > 0 && seleccionadas.size === facturasVisibles.length} onChange={() => alternarTodas(facturasVisibles)} />
              </Celda>
              {columnasMostradas.map(c => (
                <Celda key={c} cabecera>
                  <span className="etiqueta-orden">{c}</span>
                  <span className="resize-handle" onPointerDown={e => iniciarArrastre(e, c)} />
                </Celda>
              ))}
            </div>
          </div>
          <div role="rowgroup">
            {facturasVisibles.map(f => {
              const duplicada = nombresDuplicados.has(f.nombre_original);
              return (
                <div role="row" key={f.id} className="fila-tabla" style={{ gridTemplateColumns: plantillaColumnas, background: duplicada ? 'rgba(166, 124, 46, 0.08)' : undefined }}>
                  <Celda><input type="checkbox" checked={seleccionadas.has(f.id)} onChange={() => alternar(f.id)} /></Celda>
                  {columnasMostradas.map(c => (
                    <Celda key={c}>{contenidoCelda(c, f)}</Celda>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="fila" style={{ marginTop: 12 }}>
        <span className="muted">{seleccionadas.size} seleccionada(s)</span>
        <button
          className="secundario"
          disabled={seleccionadas.size === 0 || borrando}
          onClick={() => setConfirmarBorrado(true)}
        >
          {borrando ? 'Borrando...' : `Borrar seleccionadas (${seleccionadas.size})`}
        </button>
      </div>

      <ConfirmDialog
        abierto={confirmarBorrado}
        titulo={`¿Borrar ${seleccionadas.size} factura(s)?`}
        mensaje={
          seleccionadasEmparejadas > 0
            ? `⚠ ${seleccionadasEmparejadas} de las seleccionadas están emparejadas con una línea del banco — esa línea volverá a quedar pendiente. No se puede deshacer.`
            : 'No se puede deshacer.'
        }
        textoConfirmar="Borrar"
        peligroso
        onConfirmar={borrarSeleccionadas}
        onCancelar={() => setConfirmarBorrado(false)}
      />
    </div>
  );
}
