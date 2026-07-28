'use client';

import { useMemo, useState } from 'react';
import { ConfirmDialog } from './ConfirmDialog';
import { apiFetch } from '../lib/toast';

function montoCaracteristico(f) {
  if (f.totales && f.totales.length) return Math.max(...f.totales.map(Number));
  if (f.importes && f.importes.length) return Math.max(...f.importes.map(Number));
  return null;
}

export default function FacturasTrimestre({ trimestreId, facturas, onCambio }) {
  const [seleccionadas, setSeleccionadas] = useState(new Set());
  const [confirmarBorrado, setConfirmarBorrado] = useState(false);
  const [borrando, setBorrando] = useState(false);

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
      {nombresDuplicados.size > 0 && (
        <p className="muted" style={{ color: 'var(--warn)', marginTop: 0 }}>
          ⚠ {nombresDuplicados.size} nombre(s) de archivo repetido(s) — marcados abajo.
        </p>
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
        mensaje="Si alguna estaba emparejada con una línea del banco, esa línea vuelve a quedar pendiente. No se puede deshacer."
        textoConfirmar="Borrar"
        peligroso
        onConfirmar={borrarSeleccionadas}
        onCancelar={() => setConfirmarBorrado(false)}
      />
    </div>
  );
}
