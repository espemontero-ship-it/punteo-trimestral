'use client';

import { useState } from 'react';
import SubirFactura from './SubirFactura';
import { apiFetch } from '../lib/toast';

const ETIQUETAS = {
  fija: 'fija',
  factura_propia: 'factura propia',
  mixta: 'mixta',
  nueva: 'nueva',
};

export default function GrupoProveedor({ trimestreId, grupo, onCambio }) {
  const [abierto, setAbierto] = useState(false);
  const [notasManual, setNotasManual] = useState({});
  const [mensajes, setMensajes] = useState({});
  const [ambiguos, setAmbiguos] = useState({});

  const pendientes = grupo.movimientos.filter(m => m.estado !== 'resuelta');

  async function confirmarGrupoCompleto() {
    const r = await apiFetch(`/api/trimestres/${trimestreId}/proveedores/confirmar-grupo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hoja: grupo.hoja, clave: grupo.clave, nota: grupo.sugerenciaNota }),
    }, { mensajeOk: `${grupo.sinResolver} línea(s) confirmadas`, mensajeError: 'No se pudo confirmar el grupo.' });
    if (r) onCambio();
  }

  async function marcarPendiente() {
    const r = await apiFetch(`/api/trimestres/${trimestreId}/proveedores/pendiente`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hoja: grupo.hoja, clave: grupo.clave }),
    }, { mensajeOk: 'Marcado como pedida, esperando al proveedor', mensajeError: 'No se pudo marcar.' });
    if (r) onCambio();
  }

  async function confirmarLineaManual(movimientoId) {
    const nota = notasManual[movimientoId];
    if (!nota) return;
    const r = await apiFetch(`/api/movimientos/${movimientoId}/confirmar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nota }),
    }, { mensajeOk: 'Guardado', mensajeError: 'No se pudo guardar.' });
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

  return (
    <div className="tarjeta">
      <div className="fila" onClick={() => setAbierto(!abierto)} style={{ cursor: 'pointer' }}>
        <div>
          <span className={`etiqueta ${grupo.categoria}`}>{ETIQUETAS[grupo.categoria]}</span>{' '}
          <strong>{grupo.clave}</strong>
          <div className="muted">{grupo.hoja} · {grupo.resueltas}/{grupo.total} resueltas{grupo.pedidaPendiente ? ` · ${grupo.pedidaPendiente} pedida(s)` : ''}</div>
        </div>
        <div>{abierto ? '▲' : '▼'}</div>
      </div>

      {grupo.categoria === 'fija' && grupo.sinResolver > 0 && (
        <button className="grande" style={{ marginTop: 12 }} onClick={confirmarGrupoCompleto}>
          Confirmar las {grupo.sinResolver} líneas como &quot;{grupo.sugerenciaNota}&quot;
        </button>
      )}

      {abierto && (
        <div style={{ marginTop: 12 }}>
          <p className="muted">{grupo.detalle}</p>
          {grupo.sinResolver > 0 && (
            <button className="secundario" onClick={marcarPendiente} style={{ marginBottom: 12 }}>
              Marcar como pedida, esperando al proveedor
            </button>
          )}
          {pendientes.map(m => (
            <div key={m.id} className="tarjeta" style={{ background: 'transparent' }}>
              <div className="fila">
                <div>
                  <div>{m.concepto?.slice(0, 60)}</div>
                  <div className="muted">{m.fecha ? new Date(m.fecha).toLocaleDateString('es-ES') : ''} · {Number(m.importe).toFixed(2)}€
                    {m.estado === 'pedida_pendiente' && <span className="etiqueta pedida" style={{ marginLeft: 8 }}>pedida</span>}
                  </div>
                </div>
              </div>

              {grupo.categoria === 'factura_propia' ? (
                <SubirFactura
                  trimestreId={trimestreId}
                  hoja={grupo.hoja}
                  clave={grupo.clave}
                  onResultado={r => onResultadoFactura(m, r)}
                />
              ) : (
                <div className="fila" style={{ marginTop: 8 }}>
                  <input
                    type="text"
                    placeholder="Nota (ej. stripe, devolución...)"
                    value={notasManual[m.id] || ''}
                    onChange={e => setNotasManual(prev => ({ ...prev, [m.id]: e.target.value }))}
                  />
                  <button onClick={() => confirmarLineaManual(m.id)}>Confirmar</button>
                </div>
              )}

              {mensajes[m.id] && <p className="muted" style={{ marginTop: 6 }}>{mensajes[m.id]}</p>}

              {Object.values(ambiguos).flat().filter(o => o.movimientoId === m.id).length > 0 &&
                Object.entries(ambiguos).map(([facturaId, opciones]) =>
                  opciones.filter(o => o.movimientoId === m.id).map((o, i) => (
                    <button key={`${facturaId}-${i}`} className="secundario" style={{ marginTop: 6 }} onClick={() => elegirCandidato(o)}>
                      {o.esCombo ? `Confirmar combinación: factura ${o.numero} + ${o.otraFacturaNumero}` : `Es esta línea (factura ${o.numero})`}
                    </button>
                  ))
                )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
