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

export default function GrupoProveedor({ trimestreId, grupo, proyectos, onCambio }) {
  const [abierto, setAbierto] = useState(false);
  const [notasManual, setNotasManual] = useState({});
  const [mensajes, setMensajes] = useState({});
  const [ambiguos, setAmbiguos] = useState({});

  const importeTotal = grupo.movimientos.reduce((s, m) => s + Number(m.importe), 0);

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

  async function asignarProyecto(movimientoId, proyectoId) {
    const r = await apiFetch(`/api/movimientos/${movimientoId}/proyecto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ proyectoId: proyectoId || null }),
    }, { mensajeError: 'No se pudo guardar el proyecto.' });
    if (r) onCambio();
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
          <strong>{grupo.clave}</strong> <span className="categoria-texto">· {ETIQUETAS[grupo.categoria]}</span>
          <div className="muted">{grupo.hoja} · {grupo.resueltas}/{grupo.total} resueltas{grupo.pedidaPendiente ? ` · ${grupo.pedidaPendiente} pedida(s)` : ''}</div>
        </div>
        <div className="fila-cab-derecha">
          <span className="num importe-grupo">{importeTotal.toFixed(2)}€</span>
          <span>{abierto ? '▲' : '▼'}</span>
        </div>
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
          <div className="tabla-movimientos-envoltura">
            <table className="tabla-movimientos">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Concepto</th>
                  <th>Proveedor</th>
                  <th className="col-importe">Importe</th>
                  <th>Nota</th>
                  <th>Proyecto</th>
                </tr>
              </thead>
              <tbody>
                {grupo.movimientos.map(m => {
                  const resuelta = m.estado === 'resuelta';
                  const facturaIds = m.factura_ids || [];
                  return (
                    <tr key={m.id}>
                      <td className="muted">{m.fecha ? new Date(m.fecha).toLocaleDateString('es-ES') : ''}</td>
                      <td>{m.concepto?.slice(0, 60)}</td>
                      <td className="muted">{grupo.clave}</td>
                      <td className="num col-importe">{Number(m.importe).toFixed(2)}€</td>
                      <td>
                        {resuelta ? (
                          <>
                            {m.nota_final}
                            {facturaIds.length > 0 && (
                              <>
                                {' — '}
                                <a className="ver-factura" href={`/api/facturas/${facturaIds[0]}/archivo`} target="_blank" rel="noreferrer">
                                  Ver factura{facturaIds.length > 1 ? 's' : ''} →
                                </a>
                              </>
                            )}
                          </>
                        ) : (
                          m.estado === 'pedida_pendiente' && <span className="etiqueta pedida">pedida</span>
                        )}
                      </td>
                      <td>
                        <select
                          value={m.proyecto_id || ''}
                          onChange={e => asignarProyecto(m.id, e.target.value)}
                          className="select-proyecto"
                        >
                          <option value="">—</option>
                          {proyectos.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                        </select>
                        {!m.proyecto_id && m.proyecto_sugerido && (
                          <button
                            type="button"
                            className="sugerencia-proyecto"
                            onClick={() => asignarProyecto(m.id, m.proyecto_sugerido.id)}
                          >
                            ¿{m.proyecto_sugerido.nombre}?
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {grupo.movimientos.filter(m => m.estado !== 'resuelta').map(m => (
            <div key={m.id} className="tarjeta" style={{ background: 'transparent' }}>
              <p className="muted" style={{ marginTop: 0 }}>{m.concepto?.slice(0, 60)} · {Number(m.importe).toFixed(2)}€</p>
              {grupo.categoria === 'factura_propia' ? (
                <SubirFactura
                  trimestreId={trimestreId}
                  hoja={grupo.hoja}
                  clave={grupo.clave}
                  onResultado={r => onResultadoFactura(m, r)}
                />
              ) : (
                <div className="fila">
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
