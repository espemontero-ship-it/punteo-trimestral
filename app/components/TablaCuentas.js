'use client';

import { useState } from 'react';
import { importeDeFactura } from '../../lib/importeFactura.cjs';
import { Modal } from './Modal';

const FMT = n => `${Number(n || 0).toFixed(2)}€`;

const IMPORTE = f => importeDeFactura(f);

const PARA_INPUT = fecha => {
  const d = new Date(fecha);
  const dos = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
};

export default function TablaCuentas({
  lote, facturas, pagos, totales, soloLectura,
  onGuardarFactura, onSolicitarRechazo, onSolicitarBorrado,
  onCorregir, onRetirar,
  onCrearAnticipo, onPagar, cerrado,
}) {
  const [editando, setEditando] = useState(null);
  const [retirando, setRetirando] = useState(null);
  const [nuevoAnticipo, setNuevoAnticipo] = useState({ importe: '', esEfectivo: false });
  const [pagando, setPagando] = useState(false);
  const [modalAnticipoAbierto, setModalAnticipoAbierto] = useState(false);
  const [enviandoAnticipo, setEnviandoAnticipo] = useState(false);

  function onCambiarEstado(f, valor) {
    if (valor === f.estado_revision) return;
    if (valor === 'rechazada') { onSolicitarRechazo(f.id); return; }
    if (valor === 'borrada') { onSolicitarBorrado(f.id); return; }
  }

  function empezarEdicion(f) {
    const importe = IMPORTE(f);
    setRetirando(null);
    setEditando({
      id: f.id,
      concepto: f.concepto || '',
      importe: importe === null || importe === undefined ? '' : String(importe),
      fecha: f.fechas?.[0] ? PARA_INPUT(f.fechas[0]) : '',
    });
  }

  async function guardarEdicion() {
    await onCorregir(editando.id, {
      concepto: editando.concepto,
      importe: editando.importe === '' ? null : Number(editando.importe),
      fecha: editando.fecha || null,
    });
    setEditando(null);
  }

  async function confirmarRetirada(id) {
    await onRetirar(id);
    setRetirando(null);
  }

  async function crearAnticipo(e) {
    e.preventDefault();
    if (!nuevoAnticipo.importe) return;
    setEnviandoAnticipo(true);
    try {
      await onCrearAnticipo({ ...nuevoAnticipo, fecha: PARA_INPUT(new Date()) });
      setNuevoAnticipo({ importe: '', esEfectivo: false });
      setModalAnticipoAbierto(false);
    } finally {
      setEnviandoAnticipo(false);
    }
  }

  const facturasAceptadas = facturas.filter(f => f.estado_revision === 'aceptada');

  async function pagar() {
    if (facturasAceptadas.length === 0) return;
    setPagando(true);
    try {
      await onPagar({ facturaIds: facturasAceptadas.map(f => f.id), fecha: PARA_INPUT(new Date()) });
    } finally {
      setPagando(false);
    }
  }

  const cols = '1fr 120px 50px 100px 100px 100px 100px 100px 100px 220px';

  const locale = soloLectura ? 'en-GB' : 'es-ES';
  const t = soloLectura ? {
    cuentas: 'Accounts', concepto: 'Description', proveedor: 'Supplier', ver: 'View', fecha: 'Date',
    aceptada: 'Accepted', pagada: 'Paid', rechazada: 'Rejected', pagos: 'Payments', pendiente: 'Pending', estado: 'Status',
    sinConcepto: '(no description)', verLink: 'view', sinNada: 'No invoices or payments yet.',
    total: 'Total',
    estadoTexto: { aceptada: 'accepted', rechazada: 'rejected', pagada: 'paid' },
    editar: 'Edit', retirar: 'Remove', guardar: 'Save', cancelar: 'Cancel',
    seguro: 'Remove it?', si: 'Yes', no: 'No', aMano: 'amount edited by you',
    anticipo: 'Advance', pago: 'Payment', esperandoLinea: 'awaiting bank line', efectivo: 'cash',
  } : {
    cuentas: 'Cuentas', concepto: 'Concepto', proveedor: 'Proveedor', ver: 'Ver', fecha: 'Fecha',
    aceptada: 'Aceptada', pagada: 'Pagada', rechazada: 'Rechazada', pagos: 'Pagos', pendiente: 'Pendiente', estado: 'Estado',
    sinConcepto: '(sin concepto)', verLink: 'ver', sinNada: 'Todavía no hay facturas ni pagos.',
    total: 'Total',
    estadoTexto: { aceptada: 'aceptada', rechazada: 'rechazada', pagada: 'pagada' },
    editar: 'Editar', retirar: 'Retirar', guardar: 'Guardar', cancelar: 'Cancelar',
    seguro: '¿Retirar?', si: 'Sí', no: 'No', aMano: 'importe puesto a mano',
    anticipo: 'Anticipo', pago: 'Pago', esperandoLinea: 'esperando línea del banco', efectivo: 'efectivo',
  };

  const vacia = <span className="vacio">—</span>;

  return (
    <div>
      <strong>{t.cuentas}</strong>
      {cerrado && (
        <p className="muted" style={{ marginTop: 4 }}>
          {soloLectura ? 'This project is closed.' : 'Este proyecto está cerrado.'}
        </p>
      )}
      <div className="tabla-movimientos-envoltura" role="table" style={{ marginTop: 8 }}>
        <div role="rowgroup">
          <div role="row" className="fila-tabla-cabecera" style={{ gridTemplateColumns: cols }}>
            <div role="columnheader" className="celda">{t.concepto}</div>
            <div role="columnheader" className="celda">{t.proveedor}</div>
            <div role="columnheader" className="celda">{t.ver}</div>
            <div role="columnheader" className="celda">{t.fecha}</div>
            <div role="columnheader" className="celda">{t.aceptada}</div>
            <div role="columnheader" className="celda">{t.pagada}</div>
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
              <div role="cell" className="celda"></div>
            </div>
          )}

          {facturas.length === 0 && pagos.length === 0 && (
            <div role="row" className="fila-tabla" style={{ gridTemplateColumns: cols }}>
              <div role="cell" className="celda muted">{t.sinNada}</div>
            </div>
          )}

          {facturas.map(f => {
            const enAceptada = f.estado_revision === 'aceptada';
            const enPagada = f.estado_revision === 'pagada';
            const enRechazada = f.estado_revision === 'rechazada';
            const importe = IMPORTE(f);
            const enEdicion = editando?.id === f.id;

            const puedeTocarla = soloLectura && enAceptada && !cerrado && onCorregir && onRetirar;
            return (
              <div key={f.id} role="row" className="fila-tabla" style={{ gridTemplateColumns: cols }}>
                <div role="cell" className="celda concepto">
                  {enEdicion
                    ? <input type="text" value={editando.concepto} onChange={e => setEditando({ ...editando, concepto: e.target.value })} style={{ fontSize: 12, padding: '5px 6px' }} autoFocus />
                    : (f.concepto || t.sinConcepto)}
                </div>
                <div role="cell" className="celda concepto">{f.proveedor || vacia}</div>
                <div role="cell" className="celda">
                  <a className="link-factura" href={`/api/facturas/${f.id}/archivo`} target="_blank" rel="noreferrer">{t.verLink}</a>
                </div>
                <div role="cell" className="celda">
                  {enEdicion
                    ? <input type="date" value={editando.fecha} onChange={e => setEditando({ ...editando, fecha: e.target.value })} style={{ fontSize: 12, padding: '5px 6px' }} />
                    : (f.fechas?.[0] ? new Date(f.fechas[0]).toLocaleDateString(locale) : vacia)}
                </div>
                <div role="cell" className="celda col-importe importe">
                  {enEdicion
                    ? <input type="number" step="0.01" value={editando.importe} onChange={e => setEditando({ ...editando, importe: e.target.value })} style={{ fontSize: 12, padding: '5px 6px', width: '100%' }} />
                    : enAceptada
                      ? (importe === null || importe === undefined ? vacia : FMT(importe))
                      : vacia}
                </div>
                <div role="cell" className="celda col-importe importe">{enPagada && importe !== null && importe !== undefined ? FMT(importe) : vacia}</div>
                <div role="cell" className="celda col-importe importe">{enRechazada && importe !== null && importe !== undefined ? FMT(importe) : vacia}</div>
                <div role="cell" className="celda col-importe importe">{vacia}</div>
                <div role="cell" className="celda col-importe importe">{vacia}</div>
                <div role="cell" className="celda">
                  {soloLectura ? (
                    enEdicion ? (
                      <div className="celda-estado">
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button type="button" className="secundario" style={{ fontSize: 12, padding: '4px 8px' }} onClick={guardarEdicion}>{t.guardar}</button>
                          <button type="button" className="secundario" style={{ fontSize: 12, padding: '4px 8px' }} onClick={() => setEditando(null)}>{t.cancelar}</button>
                        </div>
                      </div>
                    ) : retirando === f.id ? (
                      <div className="celda-estado">
                        <span className="nota-texto">{t.seguro}</span>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button type="button" className="secundario" style={{ fontSize: 12, padding: '4px 8px' }} onClick={() => confirmarRetirada(f.id)}>{t.si}</button>
                          <button type="button" className="secundario" style={{ fontSize: 12, padding: '4px 8px' }} onClick={() => setRetirando(null)}>{t.no}</button>
                        </div>
                      </div>
                    ) : (
                      <div className="celda-estado">
                        <span className="nota-texto">
                          {f.estado_revision === 'rechazada' && (f.motivo_rechazo || t.estadoTexto.rechazada)}
                          {(f.estado_revision === 'aceptada' || f.estado_revision === 'pagada') && t.estadoTexto[f.estado_revision]}
                          {f.importe_a_mano && ` · ${t.aMano}`}
                        </span>
                        {puedeTocarla && (
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button type="button" className="secundario" style={{ fontSize: 12, padding: '4px 8px' }} onClick={() => empezarEdicion(f)}>{t.editar}</button>
                            <button type="button" className="secundario" style={{ fontSize: 12, padding: '4px 8px' }} onClick={() => { setEditando(null); setRetirando(f.id); }}>{t.retirar}</button>
                          </div>
                        )}
                      </div>
                    )
                  ) : (
                    <div className="celda-estado">
                      <select className="select-estado" value={f.estado_revision} disabled={f.estado_revision !== 'aceptada'} onChange={e => onCambiarEstado(f, e.target.value)}>
                        <option value="aceptada">aceptada</option>
                        <option value="rechazada">rechazada</option>
                        <option value="borrada">borrada</option>
                      </select>
                      {f.motivo_rechazo && <span className="muted" style={{ fontSize: 12 }}>{f.motivo_rechazo}</span>}
                      {f.importe_a_mano && <span className="muted" style={{ fontSize: 12 }}>{t.aMano}</span>}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {pagos.map(p => {
            const esAnticipo = !p.facturas_numeros || p.facturas_numeros.length === 0;
            const etiqueta = esAnticipo ? t.anticipo : t.pago;
            return (
              <div key={p.id} role="row" className="fila-tabla" style={{ gridTemplateColumns: cols }}>
                <div role="cell" className="celda concepto">{etiqueta}</div>
                <div role="cell" className="celda">{vacia}</div>
                <div role="cell" className="celda">{vacia}</div>
                <div role="cell" className="celda">{p.fecha ? new Date(p.fecha).toLocaleDateString(locale) : vacia}</div>
                <div role="cell" className="celda col-importe importe">{vacia}</div>
                <div role="cell" className="celda col-importe importe">{vacia}</div>
                <div role="cell" className="celda col-importe importe">{vacia}</div>
                <div role="cell" className="celda col-importe importe">{FMT(Math.abs(Number(p.importe)))}</div>
                <div role="cell" className="celda col-importe importe">{vacia}</div>
                <div role="cell" className="celda">
                  <span className="nota-texto muted">
                    {p.es_efectivo
                      ? t.efectivo
                      : p.movimiento_id
                        ? (soloLectura ? t.pagada : (p.movimiento_concepto?.slice(0, 30) || '—'))
                        : t.esperandoLinea}
                  </span>
                </div>
              </div>
            );
          })}

          {totales && (
            <div role="row" className="fila-tabla fila-total" style={{ gridTemplateColumns: cols }}>
              <div role="cell" className="celda">{t.total}</div>
              <div role="cell" className="celda"></div>
              <div role="cell" className="celda"></div>
              <div role="cell" className="celda"></div>
              <div role="cell" className="celda col-importe importe">{FMT(totales.totalAceptado)}</div>
              <div role="cell" className="celda col-importe importe">{FMT(totales.totalPagado)}</div>
              <div role="cell" className="celda col-importe importe">{FMT(totales.totalRechazado)}</div>
              <div role="cell" className="celda col-importe importe">{FMT(totales.totalConciliado)}</div>
              <div role="cell" className="celda col-importe importe">{FMT(totales.pendienteDePagar)}</div>
              <div role="cell" className="celda"></div>
            </div>
          )}
        </div>
      </div>

      {!soloLectura && !cerrado && (
        <div className="fila" style={{ marginTop: 12 }}>
          <button type="button" className="secundario" disabled={pagando || facturasAceptadas.length === 0} onClick={pagar}>
            {pagando ? 'Pagando...' : 'Pagar'}
          </button>
        </div>
      )}

      {!soloLectura && !cerrado && (
        <div className="fila" style={{ marginTop: 12 }}>
          <button type="button" className="secundario" onClick={() => setModalAnticipoAbierto(true)}>+ Añadir anticipo</button>
        </div>
      )}

      <Modal abierto={modalAnticipoAbierto} titulo="Añadir anticipo" onCerrar={() => setModalAnticipoAbierto(false)}>
        <form onSubmit={crearAnticipo}>
          <div style={{ marginBottom: 14 }}>
            <span className="etiqueta">Importe</span>
            <input
              type="number"
              step="0.01"
              placeholder="Ej. 50"
              value={nuevoAnticipo.importe}
              onChange={e => setNuevoAnticipo({ ...nuevoAnticipo, importe: e.target.value })}
            />
          </div>
          <label className="fila dialogo-cuerpo" style={{ gap: 8, cursor: 'pointer', marginBottom: 14, justifyContent: 'flex-start' }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={nuevoAnticipo.esEfectivo}
              onChange={e => setNuevoAnticipo({ ...nuevoAnticipo, esEfectivo: e.target.checked })} />
            En efectivo (no sale del banco)
          </label>
          <button type="submit" className="secundario" style={{ width: '100%' }} disabled={enviandoAnticipo}>
            {enviandoAnticipo ? 'Añadiendo...' : 'Añadir'}
          </button>
        </form>
      </Modal>
    </div>
  );
}
