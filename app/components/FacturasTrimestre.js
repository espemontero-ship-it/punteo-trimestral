'use client';

import { useMemo, useState } from 'react';
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

export default function FacturasTrimestre({ trimestreId, facturas, onCambio }) {
  const [seleccionadas, setSeleccionadas] = useState(new Set());
  const [confirmarBorrado, setConfirmarBorrado] = useState(false);
  const [borrando, setBorrando] = useState(false);
  const [progresoRecalculo, setProgresoRecalculo] = useState(null); // { actual, total } | null
  const [resumenRecalculo, setResumenRecalculo] = useState(null); // { conteos, detalle } | null

  const sinResolver = useMemo(() => facturas.filter(f => f.estado !== 'matcheada').length, [facturas]);
  const nombrePorId = useMemo(() => Object.fromEntries(facturas.map(f => [f.id, f.nombre_original])), [facturas]);

  // Un archivo a la vez (no un único POST largo) para poder mostrar progreso
  // real y para no arriesgarse a que el servidor corte una petición muy larga
  // a mitad si hay muchas facturas pendientes.
  async function recalcular() {
    setResumenRecalculo(null);
    const r = await apiFetch(`/api/trimestres/${trimestreId}/recalcular-facturas`, undefined, {
      mensajeError: 'No se pudo obtener la lista de facturas pendientes.',
    });
    if (!r || r.ids.length === 0) return;

    const conteos = {};
    const detalle = [];
    for (let i = 0; i < r.ids.length; i++) {
      setProgresoRecalculo({ actual: i + 1, total: r.ids.length });
      let resultado;
      try {
        const res = await fetch(`/api/facturas/${r.ids[i]}/reprocesar`, { method: 'POST' });
        resultado = await res.json();
      } catch (err) {
        resultado = { tipo: 'error', detalle: err.message };
      }
      conteos[resultado.tipo] = (conteos[resultado.tipo] || 0) + 1;
      if (resultado.tipo !== 'match_directo') {
        detalle.push({ nombre: nombrePorId[r.ids[i]] || `#${r.ids[i]}`, tipo: resultado.tipo, detalle: resultado.detalle });
      }
    }

    setProgresoRecalculo(null);
    setResumenRecalculo({ total: r.ids.length, conteos, detalle });
    mostrarToast(`${conteos.match_directo || 0} de ${r.ids.length} factura(s) emparejadas`, 'ok');
    onCambio();
  }

  function descargarInformeCsv() {
    if (!resumenRecalculo) return;
    const escapar = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const filas = [
      ['Archivo', 'Motivo', 'Detalle'].map(escapar).join(','),
      ...resumenRecalculo.detalle.map(d => [d.nombre, ETIQUETAS_TIPO[d.tipo] || d.tipo, d.detalle].map(escapar).join(',')),
    ];
    const blob = new Blob(['﻿' + filas.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `facturas-sin-resolver-${trimestreId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
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

  const duplicadasSinEmparejar = useMemo(
    () => facturas.filter(f => nombresDuplicados.has(f.nombre_original) && f.estado !== 'matcheada'),
    [facturas, nombresDuplicados]
  );

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
      <div style={{ marginBottom: 12 }}>
        <div className="fila">
          <p className="muted" style={{ margin: 0 }}>
            {sinResolver} factura(s) sin resolver todavía.
          </p>
          <button type="button" className="secundario" disabled={sinResolver === 0 || !!progresoRecalculo} onClick={recalcular}>
            {progresoRecalculo ? `Recalculando ${progresoRecalculo.actual} de ${progresoRecalculo.total}...` : 'Recalcular facturas sin resolver'}
          </button>
        </div>
        {progresoRecalculo && (
          <div className="progreso" style={{ margin: '8px 0 0' }}>
            <div style={{ width: `${(progresoRecalculo.actual / progresoRecalculo.total) * 100}%` }} />
          </div>
        )}
        {resumenRecalculo && (
          <div className="lista-sin-encontrar" style={{ marginTop: 10 }}>
            <div className="fila" style={{ marginBottom: 8 }}>
              <p className="muted" style={{ margin: 0 }}>
                {Object.entries(resumenRecalculo.conteos).map(([tipo, n]) => `${n} ${ETIQUETAS_TIPO[tipo] || tipo}`).join(' · ')}
              </p>
              {resumenRecalculo.detalle.length > 0 && (
                <button type="button" className="secundario" onClick={descargarInformeCsv}>
                  Descargar informe (CSV) — {resumenRecalculo.detalle.length}
                </button>
              )}
            </div>
            {resumenRecalculo.detalle.slice(0, 30).map((d, i) => (
              <div key={i} className="fila-sin-encontrar">
                <div className="fila-sin-encontrar-info">
                  <span>{d.nombre}</span>
                  <span className="muted">{ETIQUETAS_TIPO[d.tipo] || d.tipo}{d.detalle ? ` — ${d.detalle}` : ''}</span>
                </div>
              </div>
            ))}
            {resumenRecalculo.detalle.length > 30 && (
              <p className="muted" style={{ margin: '8px 0 0' }}>...y {resumenRecalculo.detalle.length - 30} más.</p>
            )}
          </div>
        )}
      </div>
      {nombresDuplicados.size > 0 && (
        <div className="fila" style={{ marginBottom: 8 }}>
          <p className="muted" style={{ color: 'var(--warn)', margin: 0 }}>
            ⚠ {nombresDuplicados.size} nombre(s) de archivo repetido(s) — marcados abajo.
          </p>
          {duplicadasSinEmparejar.length > 0 && (
            <button type="button" className="secundario" onClick={marcarDuplicadasSinEmparejar}>
              Marcar duplicadas sin emparejar ({duplicadasSinEmparejar.length})
            </button>
          )}
        </div>
      )}
      <div className="tabla-movimientos-envoltura">
        <table style={{ tableLayout: 'fixed', width: '100%' }}>
          <colgroup>
            <col style={{ width: 30 }} />
            <col style={{ width: 60 }} />
            <col />
            <col style={{ width: 150 }} />
            <col style={{ width: 90 }} />
            <col style={{ width: 110 }} />
            <col style={{ width: 70 }} />
          </colgroup>
          <thead>
            <tr>
              <th><input type="checkbox" checked={seleccionadas.size === facturas.length} onChange={alternarTodas} /></th>
              <th>Nº</th>
              <th>Archivo</th>
              <th>Subida</th>
              <th>Importe</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {facturas.map(f => {
              const monto = montoCaracteristico(f);
              const duplicada = nombresDuplicados.has(f.nombre_original);
              return (
                <tr key={f.id} style={duplicada ? { background: 'rgba(166, 124, 46, 0.08)' } : undefined}>
                  <td><input type="checkbox" checked={seleccionadas.has(f.id)} onChange={() => alternar(f.id)} /></td>
                  <td>{f.numero}</td>
                  <td style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {f.nombre_original}{duplicada ? ' ⚠' : ''}
                  </td>
                  <td className="muted">{f.creado_en ? new Date(f.creado_en).toLocaleString('es-ES') : ''}</td>
                  <td>{monto !== null ? `${monto.toFixed(2)}€` : '—'}</td>
                  <td className="muted">{f.estado}</td>
                  <td>
                    <a className="link-factura" href={`/api/facturas/${f.id}/archivo`} target="_blank" rel="noreferrer">ver</a>
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
