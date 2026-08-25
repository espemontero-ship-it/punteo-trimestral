'use client';

import { useEffect, useMemo, useState } from 'react';
import { ConfirmDialog } from './ConfirmDialog';
import { apiFetch, mostrarToast } from '../lib/toast';
import { useAnchosPersistidos } from '../lib/useAnchosPersistidos';
import { parseImporte } from '../../lib/numero.cjs';

import { importeDeFactura } from '../../lib/importeFactura.cjs';
import { textoComboFacturas } from '../../lib/textoCombo.cjs';

const ETIQUETAS_TIPO = {
  emparejada_ok: 'Emparejada y cuadra',
  emparejada_no_cuadra: 'Emparejada pero NO cuadra',
  match_directo: 'Emparejada',
  ambiguo: 'Varias líneas con el mismo importe',
  combo_sugerido: 'Combinación de facturas sugerida',
  sin_importe: 'No se reconoció ningún importe',
  sin_match: 'Importe no coincide con ninguna línea',
  ya_cubierta: 'Ya cubierta por otra factura',
  sin_movimientos: 'Aún no hay movimientos con los que comparar',
  imagen_sin_texto: 'Es una imagen, no se puede leer',
  error: 'Error al procesar el archivo',
};

const COLUMNAS = ['Fecha', 'Proveedor', 'Concepto', 'Importe', 'Nombre', 'Subida', 'Subido por', 'Vincular', 'Motivo', 'Movimiento'];
const ANCHO_DEFECTO = { Fecha: 115, Proveedor: 140, Concepto: 150, Importe: 70, Nombre: 190, Subida: 100, 'Subido por': 90, Vincular: 120, Motivo: 175, Movimiento: 190 };
const ANCHO_CHECKBOX = 30;

function importeInicial(f) {
  const monto = importeDeFactura(f);
  return monto !== null ? String(monto).replace('.', ',') : '';
}

function fechaInicial(f) {
  return f.fechas && f.fechas[0] ? String(f.fechas[0]).slice(0, 10) : '';
}

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
  const [confirmarCopia, setConfirmarCopia] = useState(null);
  const [borrando, setBorrando] = useState(false);
  const [edicionImporte, setEdicionImporte] = useState({});
  const [edicionFecha, setEdicionFecha] = useState({});
  const [edicionConcepto, setEdicionConcepto] = useState({});
  const [buscando, setBuscando] = useState(new Set());
  const [resultadosFila, setResultadosFila] = useState({});
  const [movimientosPendientes, setMovimientosPendientes] = useState([]);
  const [vinculandoManual, setVinculandoManual] = useState(new Set());
  const [movimientoElegido, setMovimientoElegido] = useState({});
  const [vinculando, setVinculando] = useState(new Set());
  const [soloPendientes, setSoloPendientes] = useState(true);
  const [anchos, setAnchos] = useAnchosPersistidos('punteo-anchos-facturas');
  const [mostrarColumnas, setMostrarColumnas] = useState(false);
  const [columnasVisibles, setColumnasVisibles] = useState(() => new Set(COLUMNAS));

  const [descartadas, setDescartadas] = useState(new Set());
  const viva = k => !descartadas.has(k);

  async function descartar(k, f, c) {
    setDescartadas(prev => new Set(prev).add(k));

    const { hoja, clave } = c;
    if (!hoja || !clave) return;
    const valor = [f.id, ...(c.otrasFacturas || []).map(o => o.id)].join(',');
    await apiFetch('/api/sugerencias/rechazar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hoja, clave, tipo: 'combo', valor }),
    }, { mensajeError: 'No se pudo guardar el descarte.' });
    onCambio();
  }

  function anchoDe(col) {
    return anchos[col] ?? ANCHO_DEFECTO[col] ?? 140;
  }

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

  useEffect(() => {
    let cancelado = false;
    apiFetch(`/api/movimientos-pendientes`, undefined, {
      mensajeError: 'No se pudo cargar la lista de movimientos.',
    }).then(r => { if (!cancelado && r) setMovimientosPendientes(r.movimientos || []); });
    return () => { cancelado = true; };
  }, []);

  const proveedorPorFactura = useMemo(
    () => new Map(facturas.map(f => [String(f.id), f.proveedor || null])),
    [facturas]
  );

  function detalleDe(activo, f) {
    if (!activo) return null;
    if (activo.tipo !== 'combo_sugerido') return activo.detalle;
    const otras = activo.otrasFacturas || [];
    const monto = importeDeFactura(f);
    if (otras.length === 0 || activo.lineaImporte == null || monto === null) return activo.detalle;
    return textoComboFacturas({
      propia: { monto, proveedor: f.proveedor },
      otras: otras.map(o => ({
        numero: o.numero, monto: o.monto, proveedor: proveedorPorFactura.get(String(o.id)) ?? null,
      })),
      linea: { importe: activo.lineaImporte, concepto: activo.lineaConcepto },
    });
  }

  const sinResolver = useMemo(() => facturas.filter(f => f.estado !== 'matcheada').length, [facturas]);
  const sinImporte = useMemo(
    () => facturas.filter(f => f.estado !== 'matcheada' && !(f.totales?.length || f.importes?.length)).length,
    [facturas]
  );

  function descargarInformeCsv() {
    const pendientes = facturas.filter(f => f.estado !== 'matcheada');
    if (pendientes.length === 0) return;
    const escapar = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const filas = [
      ['Archivo', 'Motivo', 'Detalle'].map(escapar).join(','),
      ...pendientes.map(f => {
        const c = f.motivo_candidatos;
        const activo = c ? { tipo: f.motivo_tipo, detalle: f.motivo_detalle, ...c } : null;
        const detalle = detalleDe(activo, f) ?? f.motivo_detalle;
        return [f.nombre_original, ETIQUETAS_TIPO[f.motivo_tipo] || f.motivo_tipo || '', detalle].map(escapar).join(',');
      }),
    ];
    const blob = new Blob(['﻿' + filas.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `facturas-sin-resolver-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function guardarCampoFactura(f) {
    const cambios = {};
    const concepto = edicionConcepto[f.id];
    if (concepto !== undefined && concepto !== (f.concepto ?? '')) cambios.concepto = concepto;
    const fecha = edicionFecha[f.id];
    if (fecha !== undefined && fecha !== fechaInicial(f)) cambios.fecha = fecha;
    const importeTexto = edicionImporte[f.id];
    if (importeTexto !== undefined && importeTexto !== importeInicial(f)) {
      const n = parseImporte(importeTexto);
      if (String(importeTexto).trim() && (isNaN(n) || n <= 0)) {
        mostrarToast(`No entiendo el importe "${importeTexto}". Escríbelo como 2.183,18 o 2183,18.`, 'error');
        return;
      }
      if (!isNaN(n) && n > 0) cambios.importe = n;
    }
    if (Object.keys(cambios).length === 0) return;
    const r = await apiFetch(`/api/facturas/${f.id}/datos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...cambios, soloGuardar: true }),
    }, { mensajeError: 'No se pudo guardar.' });
    if (r) onCambio();
  }

  async function buscarFila(f) {
    const importeTexto = String(edicionImporte[f.id] ?? importeInicial(f)).trim();
    const importe = importeTexto ? parseImporte(importeTexto) : null;
    if (importeTexto && (isNaN(importe) || importe <= 0)) {
      mostrarToast(`No entiendo el importe "${importeTexto}". Escríbelo como 2.183,18 o 2183,18.`, 'error');
      return;
    }
    const fecha = edicionFecha[f.id] ?? fechaInicial(f) ?? null;
    const concepto = edicionConcepto[f.id] ?? f.concepto ?? null;

    setBuscando(prev => new Set(prev).add(f.id));
    let resultado;
    try {
      const res = await fetch(`/api/facturas/${f.id}/datos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ importe, fecha: fecha || null, concepto: concepto || null }),
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
    } else if (!['ambiguo', 'combo_sugerido'].includes(resultado.tipo)) {

      setVinculandoManual(prev => new Set(prev).add(f.id));
    }
  }

  async function elegirCandidato(f, opcion) {

    const nota = opcion.facturaConcepto || '';
    const facturaIds = opcion.esCombo ? [opcion.facturaId, ...opcion.otrasFacturas.map(o => o.id)] : [opcion.facturaId];
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
      body: JSON.stringify({ nota: f.concepto || '', facturaIds: [f.id] }),
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

  const huellasDuplicadas = useMemo(() => {
    const conteo = {};
    for (const f of facturas) {
      if (!f.huella) continue;
      conteo[f.huella] = (conteo[f.huella] || 0) + 1;
    }
    return new Set(Object.keys(conteo).filter(h => conteo[h] > 1));
  }, [facturas]);

  const parejasMismoArchivo = useMemo(() => {
    const porHuella = {};
    for (const f of facturas) {
      if (!f.huella) continue;
      (porHuella[f.huella] ||= []).push(f);
    }
    return Object.values(porHuella)
      .filter(g => g.length > 1)
      .map(g => [...g].sort((a, b) => a.numero - b.numero))
      .sort((a, b) => a[0].numero - b[0].numero);
  }, [facturas]);

  function estaRepetida(f) {
    return nombresDuplicados.has(f.nombre_original) || (!!f.huella && huellasDuplicadas.has(f.huella));
  }

  function alternar(id) {
    setSeleccionadas(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function alternarTodas(facturasVisibles) {
    setSeleccionadas(prev => (prev.size === facturasVisibles.length ? new Set() : new Set(facturasVisibles.map(f => f.id))));
  }

  async function borrarCopia(f) {
    setConfirmarCopia(null);
    const r = await apiFetch(`/api/facturas`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [f.id] }),
    }, { mensajeOk: `Factura #${f.numero} borrada`, mensajeError: 'No se pudo borrar.' });
    if (r) onCambio();
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
    const duplicada = estaRepetida(f);
    const resultadoLocal = resultadosFila[f.id];

    const persistido = !resultadoLocal && f.estado !== 'matcheada' && f.motivo_candidatos
      ? { tipo: f.motivo_tipo, numero: f.numero, facturaConcepto: f.concepto, detalle: f.motivo_detalle, ...f.motivo_candidatos }
      : null;
    const activo = resultadoLocal || persistido;
    const detalleActivo = detalleDe(activo, f);

    const candidatos = activo?.tipo === 'ambiguo' ? activo.candidatos.map(c => ({
      movimientoId: c.movimientoId, numero: activo.numero, facturaId: f.id, facturaConcepto: activo.facturaConcepto,
      concepto: c.concepto, importe: c.importe, fecha: c.fecha, hoja: c.hoja, clave: c.clave,
    })) : activo?.tipo === 'combo_sugerido' ? [{
      movimientoId: activo.movimientoId, esCombo: true, numero: activo.numero,
      otrasFacturas: activo.otrasFacturas, facturaId: f.id,
      facturaConcepto: activo.facturaConcepto, detalle: detalleActivo,
      hoja: activo.hoja, clave: activo.clave,
    }] : null;
    const bloqueada = f.estado === 'matcheada' || !!candidatos;

    switch (col) {
      case 'Nombre':
        return (
          <a
            className="link-factura"
            href={`/api/facturas/${f.id}/archivo`}
            target="_blank"
            rel="noreferrer"
            style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}
          >
            {f.nombre_original}{duplicada ? ' ⚠' : ''}
          </a>
        );

      case 'Proveedor':
        return (
          <span title={f.proveedor || ''} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
            {f.proveedor || <span className="muted">—</span>}
          </span>
        );

      case 'Concepto':
        if (bloqueada) return <span className="muted">{f.concepto || '—'}</span>;
        return (
          <input
            type="text"
            placeholder="Concepto"
            value={edicionConcepto[f.id] ?? f.concepto ?? ''}
            onChange={e => setEdicionConcepto(prev => ({ ...prev, [f.id]: e.target.value }))}
            onBlur={() => guardarCampoFactura(f)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } }}
            style={{ fontSize: 12, padding: '5px 6px', width: '100%' }}
          />
        );

      case 'Subida':
        return (
          <span className="muted" style={{ fontSize: 11.5 }}>
            {f.creado_en ? new Date(f.creado_en).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
          </span>
        );

      case 'Subido por':
        return <span className="muted" style={{ fontSize: 11.5 }}>{f.subido_por_nombre || '—'}</span>;

      case 'Motivo':
        if (candidatos) {
          return (
            <div>
              <p className="muted" style={{ margin: '0 0 4px', fontSize: 11 }}>

                {detalleActivo || (activo.tipo === 'ambiguo' ? `${candidatos.length} líneas con el mismo importe — elige cuál es:` : 'Combinación sugerida — confirma si es correcta:')}
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {candidatos.map((c, i) => ({ c, i })).filter(({ i }) => viva(`sug:${f.id}:${i}`)).map(({ c, i }) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 4 }}>
                    <button type="button" className="secundario" style={{ textAlign: 'left', padding: '6px 10px', display: 'block', flex: 1 }} onClick={() => elegirCandidato(f, c)}>
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
                    <button
                      type="button"
                      className="sugerencia-descartar"
                      title="Descartar esta sugerencia"
                      onClick={() => descartar(`sug:${f.id}:${i}`, f, c)}
                    >✕</button>
                    {c.esCombo && c.otrasFacturas.map(o => (
                      <a key={o.id} className="link-factura" style={{ fontSize: 11, marginRight: 8 }} href={`/api/facturas/${o.id}/archivo`} target="_blank" rel="noreferrer">
                        ver factura {o.numero}
                      </a>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          );
        }

        const largos = ['ya_cubierta', 'emparejada_no_cuadra'];
        if (largos.includes((resultadoLocal || f).motivo_tipo) || largos.includes(resultadoLocal?.tipo)) {
          return <span className="muted" style={{ whiteSpace: 'normal' }}>{(resultadoLocal || f).motivo_detalle || resultadoLocal?.detalle}</span>;
        }
        return <span className="muted">{f.estado === 'matcheada' ? 'Emparejada' : (ETIQUETAS_TIPO[(resultadoLocal || f).motivo_tipo || resultadoLocal?.tipo] || (resultadoLocal || f).motivo_detalle || 'Sin recalcular todavía')}</span>;

      case 'Vincular':
        if (bloqueada) return <span className="muted">—</span>;
        if (!vinculandoManual.has(f.id)) {
          return (
            <button type="button" className="secundario" style={{ fontSize: 11, padding: '4px 8px' }} disabled={buscando.has(f.id)} onClick={() => buscarFila(f)}>
              {buscando.has(f.id) ? '...' : 'Buscar'}
            </button>
          );
        }
        return (
          <div>
            <select
              value={movimientoElegido[f.id] || ''}
              onChange={e => setMovimientoElegido(prev => ({ ...prev, [f.id]: e.target.value }))}
              style={{ fontSize: 11.5, padding: '4px 6px', width: '100%' }}
            >
              <option value="">Elige movimiento...</option>
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

        if (bloqueada) {
          const dia = fechaInicial(f);
          return <span>{dia ? new Date(dia).toLocaleDateString('es-ES') : <span className="muted">—</span>}</span>;
        }
        return (
          <input
            type="date"
            value={edicionFecha[f.id] ?? fechaInicial(f)}
            onChange={e => setEdicionFecha(prev => ({ ...prev, [f.id]: e.target.value }))}
            onBlur={() => guardarCampoFactura(f)}
            style={{ fontSize: 12, padding: '5px 6px', width: '100%' }}
          />
        );

      case 'Importe':

        if (bloqueada) {
          const monto = importeDeFactura(f);
          return <span>{monto !== null ? `${Number(monto).toFixed(2)}€` : <span className="muted">—</span>}</span>;
        }
        return (
          <input
            type="text"
            inputMode="decimal"
            placeholder="0,00"
            value={edicionImporte[f.id] ?? importeInicial(f)}
            onChange={e => setEdicionImporte(prev => ({ ...prev, [f.id]: e.target.value }))}
            onBlur={() => guardarCampoFactura(f)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } }}
            style={{ fontSize: 12, padding: '5px 6px', width: '100%' }}
          />
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
        </div>
      </div>
      {parejasMismoArchivo.length > 0 && (
        <div className="aviso-duplicados">
          <p className="aviso-duplicados-titulo">⚠ El mismo archivo está subido más de una vez</p>
          {parejasMismoArchivo.map((grupo, i) => (
            <div key={i} className="grupo-duplicado">
              {grupo.map(f => (
                <div key={f.id} className="fila-duplicado">
                  <a className="link-factura" href={`/api/facturas/${f.id}/archivo`} target="_blank" rel="noreferrer">
                    #{f.numero}
                  </a>
                  <span className="muted">{f.fechas?.[0] ? new Date(f.fechas[0]).toLocaleDateString('es-ES') : 'sin fecha'}</span>
                  <span>{importeDeFactura(f) !== null ? `${Number(importeDeFactura(f)).toFixed(2)}€` : 'sin importe'}</span>
                  <span className="muted">
                    {f.estado === 'matcheada' && f.movimiento_id
                      ? `pegada a ${f.movimiento_fecha ? new Date(f.movimiento_fecha).toLocaleDateString('es-ES') : ''} · ${Number(f.movimiento_importe).toFixed(2)}€ · ${f.movimiento_concepto?.slice(0, 40) || ''}`
                      : 'sin emparejar'}
                  </span>
                  <button type="button" className="secundario" onClick={() => setConfirmarCopia(f)}>Borrar</button>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      {nombresDuplicados.size > 0 && (
        <div className="fila" style={{ marginBottom: 8 }}>
          <p className="muted" style={{ fontWeight: 700, margin: 0 }}>
            ⚠ {nombresDuplicados.size} nombre(s) de archivo repetido(s) — marcados abajo.
          </p>
        </div>
      )}

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
            const duplicada = estaRepetida(f);
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
        abierto={!!confirmarCopia}
        titulo={confirmarCopia ? `¿Borrar la factura #${confirmarCopia.numero}?` : ''}
        mensaje={
          confirmarCopia?.estado === 'matcheada' && confirmarCopia?.movimiento_id
            ? `La línea del banco de ${Number(confirmarCopia.movimiento_importe).toFixed(2)}€ del ${confirmarCopia.movimiento_fecha ? new Date(confirmarCopia.movimiento_fecha).toLocaleDateString('es-ES') : ''} volverá a quedar sin resolver. No se puede deshacer.`
            : 'Esta copia no está emparejada con ninguna línea del banco. No se puede deshacer.'
        }
        textoConfirmar="Borrar"
        peligroso
        onConfirmar={() => borrarCopia(confirmarCopia)}
        onCancelar={() => setConfirmarCopia(null)}
      />
      <ConfirmDialog
        abierto={confirmarBorrado}
        titulo={`¿Borrar ${seleccionadas.size} factura(s)?`}
        mensaje={
          seleccionadasEmparejadas > 0
            ? `⚠ ${seleccionadasEmparejadas} de las seleccionadas están emparejadas con un movimiento — ese movimiento volverá a quedar pendiente. No se puede deshacer.`
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
