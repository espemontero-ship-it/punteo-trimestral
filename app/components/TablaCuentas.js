'use client';

import { useState } from 'react';

const FMT = n => `${Number(n || 0).toFixed(2)}€`;

// Tabla de cuentas de un lote: cada importe vive en una única columna según su
// naturaleza (Sin revisar/Aceptada/Rechazada/Pagos), nunca mezclado con texto.
// El desplegable de Estado de una factura solo cambia lo que ya está guardado
// -- elegir "Rechazada"/"Borrada" pide confirmación al padre (diálogos, como
// hoy); elegir "Cerrada" revela un campo de fecha inline antes de guardar,
// igual que "adelanto colaborador" revela sus propios campos en Movimientos.
// soloLectura la reutiliza tal cual en la vista del colaborador: sin
// desplegable, sin borrar, sin vincular pagos.
export default function TablaCuentas({
  lote, facturas, pagos, totales, soloLectura,
  onGuardarFactura, onSolicitarRechazo, onSolicitarBorrado,
  movimientos, onVincular, onCrearPago,
}) {
  const [cerrando, setCerrando] = useState(null); // { id, fecha }
  const [nuevoPago, setNuevoPago] = useState({ importe: '', fecha: '', nota: '' });

  function onCambiarEstado(f, valor) {
    if (valor === f.estado_revision) return;
    if (valor === 'rechazada') { onSolicitarRechazo(f.id); return; }
    if (valor === 'borrada') { onSolicitarBorrado(f.id); return; }
    if (valor === 'cerrada') { setCerrando({ id: f.id, fecha: '' }); return; }
    onGuardarFactura(f.id, { estadoRevision: valor });
  }

  function confirmarCierre() {
    if (!cerrando?.fecha) return;
    onGuardarFactura(cerrando.id, { estadoRevision: 'cerrada', fechaCierre: cerrando.fecha });
    setCerrando(null);
  }

  async function crearPago(e) {
    e.preventDefault();
    if (!nuevoPago.importe) return;
    await onCrearPago(nuevoPago);
    setNuevoPago({ importe: '', fecha: '', nota: '' });
  }

  const cols = '1fr 50px 100px 100px 100px 100px 100px 100px 220px';

  // soloLectura solo es true en la vista de colaborador (nunca en la de
  // administración) -- se usa como interruptor de idioma: colaboradores ven
  // esta tabla compartida en inglés, administración la sigue viendo en
  // español, sin necesidad de una i18n de verdad para un único componente.
  const locale = soloLectura ? 'en-GB' : 'es-ES';
  const t = soloLectura ? {
    cuentas: 'Accounts', concepto: 'Description', ver: 'View', fecha: 'Date',
    sinRevisar: 'Unreviewed', aceptada: 'Accepted', rechazada: 'Rejected', pagos: 'Payments', pendiente: 'Pending', estado: 'Status',
    sinConcepto: '(no description)', verLink: 'view', sinNada: 'No invoices or payments yet.',
    cerrada: 'Closed', pago: 'Payment', total: 'Total',
    estadoTexto: { subida: 'unreviewed', aceptada: 'accepted', rechazada: 'rejected' },
  } : {
    cuentas: 'Cuentas', concepto: 'Concepto', ver: 'Ver', fecha: 'Fecha',
    sinRevisar: 'Sin revisar', aceptada: 'Aceptada', rechazada: 'Rechazada', pagos: 'Pagos', pendiente: 'Pendiente', estado: 'Estado',
    sinConcepto: '(sin concepto)', verLink: 'ver', sinNada: 'Todavía no hay facturas ni pagos.',
    cerrada: 'Cerrada', pago: 'Pago', total: 'Total',
    estadoTexto: { subida: 'subida', aceptada: 'aceptada', rechazada: 'rechazada' },
  };

  return (
    <div>
      <strong>{t.cuentas}</strong>
      <div className="tabla-movimientos-envoltura" role="table" style={{ marginTop: 8 }}>
        <div role="rowgroup">
          <div role="row" className="fila-tabla-cabecera" style={{ gridTemplateColumns: cols }}>
            <div role="columnheader" className="celda">{t.concepto}</div>
            <div role="columnheader" className="celda">{t.ver}</div>
            <div role="columnheader" className="celda">{t.fecha}</div>
            <div role="columnheader" className="celda">{t.sinRevisar}</div>
            <div role="columnheader" className="celda">{t.aceptada}</div>
            <div role="columnheader" className="celda">{t.rechazada}</div>
            <div role="columnheader" className="celda">{t.pagos}</div>
            <div role="columnheader" className="celda">{t.pendiente}</div>
            <div role="columnheader" className="celda">{t.estado}</div>
          </div>
        </div>
        <div role="rowgroup">
          {lote && (
            <div role="row" className="fila-tabla fila-grupo" style={{ gridTemplateColumns: cols }}>
              <div role="cell" className="celda"><div className="grupo-nombre">{lote.colaborador_nombre} — {lote.evento}</div></div>
              <div role="cell" className="celda"></div>
              <div role="cell" className="celda"></div>
              <div role="cell" className="celda"></div>
              <div role="cell" className="celda"></div>
              <div role="cell" className="celda"></div>
              <div role="cell" className="celda"></div>
              <div role="cell" className="celda"></div>
              <div role="cell" className="celda"></div>
            </div>
          )}

          {facturas.length === 0 && pagos.length === 0 && (
            <div role="row" className="fila-tabla" style={{ gridTemplateColumns: cols }}>
              <div role="cell" className="celda muted">{t.sinNada}</div>
            </div>
          )}

          {facturas.map(f => {
            const enSubida = f.estado_revision === 'subida';
            const enAceptada = f.estado_revision === 'aceptada' || f.estado_revision === 'cerrada';
            const enRechazada = f.estado_revision === 'rechazada';
            const bloqueada = f.estado_revision === 'cerrada';
            return (
              <div key={f.id} role="row" className="fila-tabla" style={{ gridTemplateColumns: cols }}>
                <div role="cell" className="celda concepto">{f.concepto || t.sinConcepto}</div>
                <div role="cell" className="celda">
                  <a className="link-factura" href={`/api/facturas/${f.id}/archivo`} target="_blank" rel="noreferrer">{t.verLink}</a>
                </div>
                <div role="cell" className="celda">{f.fechas?.[0] ? new Date(f.fechas[0]).toLocaleDateString(locale) : <span className="vacio">—</span>}</div>
                <div role="cell" className="celda col-importe importe">{enSubida ? FMT(f.importe_declarado) : <span className="vacio">—</span>}</div>
                <div role="cell" className="celda col-importe importe">{enAceptada ? FMT(f.importe_declarado) : <span className="vacio">—</span>}</div>
                <div role="cell" className="celda col-importe importe">{enRechazada ? FMT(f.importe_declarado) : <span className="vacio">—</span>}</div>
                <div role="cell" className="celda col-importe importe"><span className="vacio">—</span></div>
                <div role="cell" className="celda col-importe importe"><span className="vacio">—</span></div>
                <div role="cell" className="celda">
                  {soloLectura ? (
                    <span className="nota-texto">
                      {f.estado_revision === 'cerrada' && `${t.cerrada} · ${new Date(f.fecha_cierre).toLocaleDateString(locale)}`}
                      {f.estado_revision === 'rechazada' && (f.motivo_rechazo || t.estadoTexto.rechazada)}
                      {(f.estado_revision === 'subida' || f.estado_revision === 'aceptada') && t.estadoTexto[f.estado_revision]}
                    </span>
                  ) : cerrando?.id === f.id ? (
                    <div className="celda-estado">
                      <input type="date" value={cerrando.fecha} onChange={e => setCerrando({ ...cerrando, fecha: e.target.value })} style={{ fontSize: 12, padding: '5px 6px' }} autoFocus />
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button type="button" className="secundario" style={{ fontSize: 11, padding: '4px 8px' }} disabled={!cerrando.fecha} onClick={confirmarCierre}>Confirmar</button>
                        <button type="button" className="secundario" style={{ fontSize: 11, padding: '4px 8px' }} onClick={() => setCerrando(null)}>Cancelar</button>
                      </div>
                    </div>
                  ) : (
                    <div className="celda-estado">
                      <select className="select-estado" value={f.estado_revision} disabled={bloqueada} onChange={e => onCambiarEstado(f, e.target.value)}>
                        <option value="subida">revisar</option>
                        <option value="aceptada">aceptada</option>
                        <option value="rechazada">rechazada</option>
                        <option value="cerrada">cerrada</option>
                        <option value="borrada">borrada</option>
                      </select>
                      {f.motivo_rechazo && <span className="muted" style={{ fontSize: 11 }}>{f.motivo_rechazo}</span>}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {pagos.map(p => (
            <div key={p.id} role="row" className="fila-tabla" style={{ gridTemplateColumns: cols }}>
              <div role="cell" className="celda concepto">{t.pago}{p.nota ? ` — ${p.nota}` : ''}</div>
              <div role="cell" className="celda"><span className="vacio">—</span></div>
              <div role="cell" className="celda">{p.fecha ? new Date(p.fecha).toLocaleDateString(locale) : <span className="vacio">—</span>}</div>
              <div role="cell" className="celda col-importe importe"><span className="vacio">—</span></div>
              <div role="cell" className="celda col-importe importe"><span className="vacio">—</span></div>
              <div role="cell" className="celda col-importe importe"><span className="vacio">—</span></div>
              <div role="cell" className="celda col-importe importe">−{FMT(p.importe)}</div>
              <div role="cell" className="celda col-importe importe"><span className="vacio">—</span></div>
              <div role="cell" className="celda">
                {soloLectura ? null : p.movimiento_id ? (
                  <span className="nota-texto muted">Vinculado: {p.movimiento_concepto?.slice(0, 30)}</span>
                ) : (
                  <VincularPago
                    movimientos={movimientos}
                    facturasAceptadas={facturas.filter(f => f.estado_revision === 'aceptada')}
                    onVincular={(movimientoId, facturaIds) => onVincular(p.id, movimientoId, facturaIds)}
                  />
                )}
              </div>
            </div>
          ))}

          {totales && (
            <div role="row" className="fila-tabla fila-total" style={{ gridTemplateColumns: cols }}>
              <div role="cell" className="celda">{t.total}</div>
              <div role="cell" className="celda"></div>
              <div role="cell" className="celda"></div>
              <div role="cell" className="celda col-importe importe">{FMT(totales.totalSinRevisar)}</div>
              <div role="cell" className="celda col-importe importe">{FMT(totales.totalAceptado)}</div>
              <div role="cell" className="celda col-importe importe">{FMT(totales.totalRechazado)}</div>
              <div role="cell" className="celda col-importe importe">−{FMT(totales.totalPagado)}</div>
              <div role="cell" className="celda col-importe importe">{FMT(totales.pendiente)}</div>
              <div role="cell" className="celda"></div>
            </div>
          )}
        </div>
      </div>

      {!soloLectura && (
        <form onSubmit={crearPago} style={{ marginTop: 12 }}>
          <div className="fila">
            <input type="number" step="0.01" placeholder="Importe del pago" value={nuevoPago.importe} onChange={e => setNuevoPago({ ...nuevoPago, importe: e.target.value })} />
            <input type="date" value={nuevoPago.fecha} onChange={e => setNuevoPago({ ...nuevoPago, fecha: e.target.value })} />
          </div>
          <div style={{ height: 8 }} />
          <input type="text" placeholder="Nota (ej. anticipo, diferencia...)" value={nuevoPago.nota} onChange={e => setNuevoPago({ ...nuevoPago, nota: e.target.value })} />
          <div style={{ height: 8 }} />
          <button type="submit" className="secundario">+ Añadir pago</button>
        </form>
      )}
    </div>
  );
}

function VincularPago({ movimientos, facturasAceptadas, onVincular }) {
  const [movimientoId, setMovimientoId] = useState('');
  const [seleccionadas, setSeleccionadas] = useState([]);

  function toggle(id) {
    setSeleccionadas(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: '100%' }}>
      <select style={{ fontSize: 11.5, padding: '4px 6px' }} value={movimientoId} onChange={e => setMovimientoId(e.target.value)}>
        <option value="">Elige movimiento...</option>
        {(movimientos || []).map(m => (
          <option key={m.id} value={m.id}>
            {m.fecha ? new Date(m.fecha).toLocaleDateString('es-ES') : ''} · {Number(m.importe).toFixed(2)}€ · {m.concepto?.slice(0, 30)}
          </option>
        ))}
      </select>
      {facturasAceptadas.length > 0 && (
        <div style={{ fontSize: 11 }}>
          {facturasAceptadas.map(f => (
            <label key={f.id} style={{ display: 'block' }}>
              <input type="checkbox" checked={seleccionadas.includes(f.id)} onChange={() => toggle(f.id)} />
              {' '}#{f.numero} {f.concepto || ''}
            </label>
          ))}
        </div>
      )}
      <button type="button" className="secundario" style={{ fontSize: 11, padding: '4px 8px' }} disabled={!movimientoId} onClick={() => onVincular(movimientoId, seleccionadas)}>
        Vincular
      </button>
    </div>
  );
}
