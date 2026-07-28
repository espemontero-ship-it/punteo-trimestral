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

export default function FacturasTrimestre({ trimestreId, facturas, onCambio }) {
  const [seleccionadas, setSeleccionadas] = useState(new Set());
  const [confirmarBorrado, setConfirmarBorrado] = useState(false);
  const [borrando, setBorrando] = useState(false);
  const [progresoRecalculo, setProgresoRecalculo] = useState(null); // { actual, total } | null
  const [edicionImporte, setEdicionImporte] = useState({});
  const [edicionFecha, setEdicionFecha] = useState({});
  const [buscando, setBuscando] = useState(new Set());
  const [resultadosFila, setResultadosFila] = useState({}); // { [facturaId]: resultado } — sobreescribe el motivo guardado hasta recargar
  const [movimientosPendientes, setMovimientosPendientes] = useState([]);
  const [vinculandoManual, setVinculandoManual] = useState(new Set());
  const [movimientoElegido, setMovimientoElegido] = useState({});
  const [vinculando, setVinculando] = useState(new Set());

  // Lista de movimientos pendientes para poder vincular una factura a mano
  // cuando ya se sabe cuál es, sin depender de que el importe/fecha encajen
  // solos (ej. facturas con varios importes dentro de un mismo archivo).
  useEffect(() => {
    let cancelado = false;
    apiFetch(`/api/trimestres/${trimestreId}/movimientos-pendientes`, undefined, {
      mensajeError: 'No se pudo cargar la lista de movimientos.',
    }).then(r => { if (!cancelado && r) setMovimientosPendientes(r.movimientos || []); });
    return () => { cancelado = true; };
  }, [trimestreId]);

  const sinResolver = useMemo(() => facturas.filter(f => f.estado !== 'matcheada').length, [facturas]);

  // Un archivo a la vez (no un único POST largo) para poder mostrar progreso
  // real y para no arriesgarse a que el servidor corte una petición muy larga
  // a mitad si hay muchas facturas pendientes.
  async function recalcular() {
    const r = await apiFetch(`/api/trimestres/${trimestreId}/recalcular-facturas`, undefined, {
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
    a.download = `facturas-sin-resolver-${trimestreId}.csv`;
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

  function alternarTodas() {
    setSeleccionadas(prev => (prev.size === facturas.length ? new Set() : new Set(facturas.map(f => f.id))));
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
    const r = await apiFetch(`/api/trimestres/${trimestreId}/facturas`, {
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

  return (
    <div>
      <div className="fila" style={{ marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <p className="muted" style={{ margin: 0 }}>
          {sinResolver} factura(s) sin resolver todavía.
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="secundario" onClick={descargarInformeCsv} disabled={sinResolver === 0}>
            Descargar CSV
          </button>
          <button type="button" className="secundario" disabled={sinResolver === 0 || !!progresoRecalculo} onClick={recalcular}>
            {progresoRecalculo ? `Recalculando ${progresoRecalculo.actual} de ${progresoRecalculo.total}...` : 'Recalcular facturas sin resolver'}
          </button>
        </div>
      </div>
      {progresoRecalculo && (
        <div className="progreso" style={{ margin: '0 0 12px' }}>
          <div style={{ width: `${(progresoRecalculo.actual / progresoRecalculo.total) * 100}%` }} />
        </div>
      )}
      {nombresDuplicados.size > 0 && (
        <div className="fila" style={{ marginBottom: 8 }}>
          <p className="muted" style={{ color: 'var(--warn)', margin: 0 }}>
            ⚠ {nombresDuplicados.size} nombre(s) de archivo repetido(s) — marcados abajo.
          </p>
          <button type="button" className="secundario" disabled={duplicadasSinEmparejar.length === 0} onClick={marcarDuplicadasSinEmparejar}>
            Marcar duplicadas sin emparejar ({duplicadasSinEmparejar.length})
          </button>
        </div>
      )}

      <div className="tabla-movimientos-envoltura">
        <table style={{ tableLayout: 'fixed', width: '100%' }}>
          <colgroup>
            <col style={{ width: 30 }} />
            <col />
            <col style={{ width: 45 }} />
            <col style={{ width: 220 }} />
            <col style={{ width: 220 }} />
            <col style={{ width: 140 }} />
            <col style={{ width: 100 }} />
            <col style={{ width: 90 }} />
          </colgroup>
          <thead>
            <tr>
              <th><input type="checkbox" checked={seleccionadas.size === facturas.length} onChange={alternarTodas} /></th>
              <th>Archivo</th>
              <th>Ver</th>
              <th>Motivo</th>
              <th>Movimiento emparejado</th>
              <th>Fecha factura</th>
              <th>Importe</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {facturas.map(f => {
              const duplicada = nombresDuplicados.has(f.nombre_original);
              const resultadoLocal = resultadosFila[f.id];
              const candidatos = resultadoLocal?.tipo === 'ambiguo' ? resultadoLocal.candidatos.map(c => ({
                movimientoId: c.movimientoId, numero: resultadoLocal.numero, facturaId: f.id, facturaConcepto: resultadoLocal.facturaConcepto,
                concepto: c.concepto, importe: c.importe, fecha: c.fecha,
              })) : resultadoLocal?.tipo === 'combo_sugerido' ? [{
                movimientoId: resultadoLocal.movimientoId, esCombo: true, numero: resultadoLocal.numero,
                otraFacturaNumero: resultadoLocal.otraFacturaNumero, facturaId: f.id, otraFacturaId: resultadoLocal.otraFacturaId,
                facturaConcepto: resultadoLocal.facturaConcepto,
              }] : null;

              return (
                <tr key={f.id} style={duplicada ? { background: 'rgba(166, 124, 46, 0.08)' } : undefined}>
                  <td><input type="checkbox" checked={seleccionadas.has(f.id)} onChange={() => alternar(f.id)} /></td>
                  <td style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {f.nombre_original}{duplicada ? ' ⚠' : ''}
                  </td>
                  <td>
                    <a className="link-factura" href={`/api/facturas/${f.id}/archivo`} target="_blank" rel="noreferrer">ver</a>
                  </td>

                  <td className="muted" style={{ whiteSpace: 'normal' }}>
                    {candidatos ? (
                      <>
                        <p style={{ margin: '0 0 4px', fontSize: 11 }}>
                          {resultadoLocal.tipo === 'ambiguo' ? `${candidatos.length} líneas con el mismo importe — elige cuál es:` : 'Combinación sugerida — confirma si es correcta:'}
                        </p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {candidatos.map((c, i) => (
                            <button key={i} type="button" className="secundario" style={{ textAlign: 'left', fontSize: 11.5, padding: '5px 9px' }} onClick={() => elegirCandidato(f, c)}>
                              {c.esCombo
                                ? `Combinar con factura ${c.otraFacturaNumero}`
                                : `${c.fecha ? new Date(c.fecha).toLocaleDateString('es-ES') + ' · ' : ''}${c.concepto?.slice(0, 45)}`}
                            </button>
                          ))}
                        </div>
                      </>
                    ) : f.estado === 'matcheada' ? (
                      'Emparejada'
                    ) : vinculandoManual.has(f.id) ? (
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
                    ) : (
                      <>
                        {ETIQUETAS_TIPO[(resultadoLocal || f).motivo_tipo || resultadoLocal?.tipo] || (resultadoLocal || f).motivo_detalle || 'Sin recalcular todavía'}
                        <button type="button" className="quitar-grupo" onClick={() => alternarVinculoManual(f.id)}>vincular a mano</button>
                      </>
                    )}
                  </td>

                  <td className="muted" style={{ whiteSpace: 'normal' }}>
                    {f.estado === 'matcheada'
                      ? `${f.movimiento_fecha ? new Date(f.movimiento_fecha).toLocaleDateString('es-ES') + ' · ' : ''}${f.movimiento_concepto?.slice(0, 40) || ''} · ${f.movimiento_importe !== undefined && f.movimiento_importe !== null ? `${Number(f.movimiento_importe).toFixed(2)}€` : ''}`
                      : '—'}
                  </td>

                  <td>
                    {f.estado !== 'matcheada' && !candidatos ? (
                      <input
                        type="date"
                        value={edicionFecha[f.id] ?? fechaInicial(f)}
                        onChange={e => setEdicionFecha(prev => ({ ...prev, [f.id]: e.target.value }))}
                        style={{ fontSize: 12, padding: '5px 6px' }}
                      />
                    ) : <span className="muted">—</span>}
                  </td>
                  <td>
                    {f.estado !== 'matcheada' && !candidatos ? (
                      <input
                        type="text"
                        inputMode="decimal"
                        placeholder="0,00"
                        value={edicionImporte[f.id] ?? importeInicial(f)}
                        onChange={e => setEdicionImporte(prev => ({ ...prev, [f.id]: e.target.value }))}
                        style={{ fontSize: 12, padding: '5px 6px', width: '100%' }}
                      />
                    ) : <span className="muted">—</span>}
                  </td>

                  <td>
                    {f.estado !== 'matcheada' && !candidatos && (
                      <button type="button" className="secundario" style={{ fontSize: 11, padding: '4px 8px' }} disabled={buscando.has(f.id)} onClick={() => buscarFila(f)}>
                        {buscando.has(f.id) ? '...' : 'Buscar'}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
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
