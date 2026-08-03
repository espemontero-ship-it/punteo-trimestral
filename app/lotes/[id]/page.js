'use client';

import { useEffect, useState, useCallback, use } from 'react';
import { ConfirmDialog, MotivoDialog } from '../../components/ConfirmDialog';
import { apiFetch } from '../../lib/toast';

const MOTIVOS_RECHAZO = ['Ticket, no factura', 'Duplicada', 'Importe no coincide'];

export default function LotePage({ params }) {
  const { id } = use(params);
  const [lote, setLote] = useState(null);
  const [facturas, setFacturas] = useState([]);
  const [pagos, setPagos] = useState([]);
  const [totales, setTotales] = useState(null);
  const [movimientos, setMovimientos] = useState([]);
  const [nuevoPago, setNuevoPago] = useState({ importe: '', fecha: '', nota: '' });
  const [aRechazar, setARechazar] = useState(null);
  const [aBorrar, setABorrar] = useState(null);

  const cargar = useCallback(async () => {
    const r = await apiFetch(`/api/lotes/${id}`, undefined, { mensajeError: 'No se pudo cargar el lote.' });
    if (!r) return;
    setLote(r.lote);
    setFacturas(r.facturas || []);
    setPagos(r.pagos || []);
    setTotales(r.totales);
    if (r.lote) {
      const rm = await apiFetch(`/api/movimientos-pendientes`);
      setMovimientos((rm && rm.movimientos) || []);
    }
  }, [id]);

  useEffect(() => { cargar(); }, [cargar]);

  async function guardarFactura(facturaId, campos, opciones = {}) {
    const r = await apiFetch(`/api/lotes/${id}/facturas/${facturaId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(campos),
    }, { mensajeOk: opciones.mensajeOk, mensajeError: 'No se pudo guardar.' });
    if (r) cargar();
  }

  async function confirmarRechazo(motivo) {
    const facturaId = aRechazar;
    setARechazar(null);
    await guardarFactura(facturaId, { estadoRevision: 'rechazada', motivoRechazo: motivo }, { mensajeOk: 'Factura rechazada' });
  }

  async function confirmarBorrado() {
    const facturaId = aBorrar;
    setABorrar(null);
    const r = await apiFetch(`/api/lotes/${id}/facturas/${facturaId}`, { method: 'DELETE' }, {
      mensajeOk: 'Factura borrada', mensajeError: 'No se pudo borrar.',
    });
    if (r) cargar();
  }

  async function crearPago(e) {
    e.preventDefault();
    if (!nuevoPago.importe) return;
    const r = await apiFetch(`/api/lotes/${id}/pagos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(nuevoPago),
    }, { mensajeOk: 'Pago añadido', mensajeError: 'No se pudo añadir el pago.' });
    if (r) {
      setNuevoPago({ importe: '', fecha: '', nota: '' });
      cargar();
    }
  }

  async function vincularPago(pagoId, movimientoId, facturaIds) {
    if (!movimientoId) return;
    const r = await apiFetch(`/api/pagos/${pagoId}/vincular`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ movimientoId: Number(movimientoId), facturaIds }),
    }, { mensajeOk: 'Pago vinculado a la línea del banco', mensajeError: 'No se pudo vincular.' });
    if (r) cargar();
  }

  if (!lote) return <div className="contenedor"><p className="muted">Cargando...</p></div>;

  const aceptadasSinPago = facturas.filter(f => f.estado_revision === 'aceptada');

  return (
    <div className="contenedor">
      <div className="fila" style={{ marginTop: 16 }}>
        <div>
          <h1 style={{ margin: 0 }}>{lote.evento}</h1>
          <p className="muted" style={{ margin: 0 }}>{lote.colaborador_nombre} · {lote.trimestre_id}</p>
        </div>
        <a href="/"><button className="secundario">Volver</button></a>
      </div>

      {totales && (
        <div className="tarjeta">
          <div className="fila"><span>Total subido</span><strong>{totales.totalSubido.toFixed(2)}€</strong></div>
          <div className="fila"><span>Total aceptado</span><strong>{totales.totalAceptado.toFixed(2)}€</strong></div>
          <div className="fila"><span>Total pagado</span><strong>{totales.totalPagado.toFixed(2)}€</strong></div>
          <div className="fila"><span>Diferencia pendiente</span><strong>{totales.diferencia.toFixed(2)}€</strong></div>
          {totales.pendientesRevision > 0 && (
            <p className="muted" style={{ marginTop: 8 }}>{totales.pendientesRevision} factura(s) sin revisar todavía.</p>
          )}
        </div>
      )}

      <div className="tarjeta">
        <strong>Facturas</strong>
        {facturas.length === 0 && <p className="muted">Todavía no ha subido ninguna.</p>}
        {facturas.map(f => (
          <FilaFactura
            key={f.id}
            factura={f}
            onGuardar={c => guardarFactura(f.id, c, { mensajeOk: 'Guardado' })}
            onRechazar={() => setARechazar(f.id)}
            onBorrar={() => setABorrar(f.id)}
          />
        ))}
      </div>

      <div className="tarjeta">
        <strong>Pagos</strong>
        {pagos.map(p => (
          <div key={p.id} className="tarjeta" style={{ background: 'rgba(255,255,255,0.03)' }}>
            <div className="fila">
              <div>
                <strong>{Number(p.importe).toFixed(2)}€</strong> {p.nota ? `— ${p.nota}` : ''}
                <div className="muted">{p.fecha ? new Date(p.fecha).toLocaleDateString('es-ES') : 'sin fecha'}</div>
              </div>
            </div>
            {p.movimiento_id ? (
              <p className="muted" style={{ marginTop: 6 }}>✅ Vinculado a: {p.movimiento_concepto?.slice(0, 50)}</p>
            ) : (
              <VincularPago
                movimientos={movimientos}
                facturasAceptadas={aceptadasSinPago}
                onVincular={(movimientoId, facturaIds) => vincularPago(p.id, movimientoId, facturaIds)}
              />
            )}
          </div>
        ))}

        <form onSubmit={crearPago} style={{ marginTop: 12 }}>
          <div className="fila">
            <input type="number" step="0.01" placeholder="Importe" value={nuevoPago.importe} onChange={e => setNuevoPago({ ...nuevoPago, importe: e.target.value })} />
            <input type="date" value={nuevoPago.fecha} onChange={e => setNuevoPago({ ...nuevoPago, fecha: e.target.value })} />
          </div>
          <div style={{ height: 8 }} />
          <input type="text" placeholder="Nota (ej. anticipo, diferencia...)" value={nuevoPago.nota} onChange={e => setNuevoPago({ ...nuevoPago, nota: e.target.value })} />
          <div style={{ height: 8 }} />
          <button type="submit">+ Añadir pago</button>
        </form>
      </div>

      <MotivoDialog
        abierto={!!aRechazar}
        titulo="Rechazar factura"
        opciones={MOTIVOS_RECHAZO}
        onConfirmar={confirmarRechazo}
        onCancelar={() => setARechazar(null)}
      />
      <ConfirmDialog
        abierto={!!aBorrar}
        titulo="¿Borrar esta factura del lote?"
        textoConfirmar="Borrar"
        peligroso
        onConfirmar={confirmarBorrado}
        onCancelar={() => setABorrar(null)}
      />
    </div>
  );
}

function FilaFactura({ factura: f, onGuardar, onRechazar, onBorrar }) {
  const [concepto, setConcepto] = useState(f.concepto || '');
  const [importe, setImporte] = useState(f.importe_declarado ?? '');
  const [fecha, setFecha] = useState(f.fechas?.[0] ? String(f.fechas[0]).slice(0, 10) : '');

  return (
    <div className="tarjeta" style={{ background: 'rgba(255,255,255,0.03)' }}>
      <div className="fila">
        <span className={`etiqueta ${f.estado_revision === 'aceptada' ? 'fija' : f.estado_revision === 'rechazada' ? 'nueva' : 'mixta'}`}>
          {f.estado_revision}
        </span>
        <a href={`/api/facturas/${f.id}/archivo`} target="_blank" rel="noreferrer">Ver archivo</a>
      </div>
      <div style={{ height: 8 }} />
      <input
        type="text" placeholder="Concepto" value={concepto}
        onChange={e => setConcepto(e.target.value)}
        onBlur={() => concepto !== (f.concepto || '') && onGuardar({ concepto })}
      />
      <div style={{ height: 8 }} />
      <input
        type="number" step="0.01" placeholder="Importe" value={importe}
        onChange={e => setImporte(e.target.value)}
        onBlur={() => Number(importe) !== Number(f.importe_declarado || 0) && onGuardar({ importe: Number(importe) })}
      />
      <div style={{ height: 8 }} />
      <input
        type="date" value={fecha}
        onChange={e => setFecha(e.target.value)}
        onBlur={() => fecha && fecha !== (f.fechas?.[0] ? String(f.fechas[0]).slice(0, 10) : '') && onGuardar({ fecha })}
      />
      {f.motivo_rechazo && <p className="muted" style={{ marginTop: 6 }}>Motivo: {f.motivo_rechazo}</p>}
      <div className="fila" style={{ marginTop: 8, gap: 8 }}>
        <button onClick={() => onGuardar({ estadoRevision: 'aceptada' })} disabled={f.estado_revision === 'aceptada'}>Aceptar</button>
        <button className="secundario" onClick={onRechazar} disabled={f.estado_revision === 'rechazada'}>Rechazar</button>
        <button className="secundario" onClick={onBorrar}>Borrar</button>
      </div>
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
    <div style={{ marginTop: 8 }}>
      <select value={movimientoId} onChange={e => setMovimientoId(e.target.value)}>
        <option value="">Elige línea del banco...</option>
        {movimientos.map(m => (
          <option key={m.id} value={m.id}>
            {m.fecha ? new Date(m.fecha).toLocaleDateString('es-ES') : ''} · {Number(m.importe).toFixed(2)}€ · {m.concepto?.slice(0, 40)}
          </option>
        ))}
      </select>
      {facturasAceptadas.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <p className="muted">Facturas que justifica este pago (opcional):</p>
          {facturasAceptadas.map(f => (
            <label key={f.id} style={{ display: 'block', fontSize: 14 }}>
              <input type="checkbox" checked={seleccionadas.includes(f.id)} onChange={() => toggle(f.id)} />
              {' '}#{f.numero} — {f.concepto || '(sin concepto)'} — {Number(f.importe_declarado || 0).toFixed(2)}€
            </label>
          ))}
        </div>
      )}
      <button style={{ marginTop: 8 }} onClick={() => onVincular(movimientoId, seleccionadas)} disabled={!movimientoId}>
        Vincular
      </button>
    </div>
  );
}
