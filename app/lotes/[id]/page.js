'use client';

import { useEffect, useState, useCallback, use } from 'react';
import { ConfirmDialog, MotivoDialog } from '../../components/ConfirmDialog';
import TablaCuentas from '../../components/TablaCuentas';
import CabeceraApp from '../../components/CabeceraApp';
import { apiFetch } from '../../lib/toast';

async function cerrarSesion() {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/login';
}

const MOTIVOS_RECHAZO = ['Ticket, no factura', 'Duplicada', 'Importe no coincide'];

export default function LotePage({ params }) {
  const { id } = use(params);
  const [lote, setLote] = useState(null);
  const [facturas, setFacturas] = useState([]);
  const [pagos, setPagos] = useState([]);
  const [totales, setTotales] = useState(null);
  const [movimientos, setMovimientos] = useState([]);
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

  async function crearPago(campos) {
    const r = await apiFetch(`/api/lotes/${id}/pagos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(campos),
    }, { mensajeOk: 'Pago añadido', mensajeError: 'No se pudo añadir el pago.' });
    if (r) cargar();
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

  if (!lote) return (
    <div className="contenedor contenedor-ancho">
      <CabeceraApp pestanaActiva="colaboradores" cerrarSesion={cerrarSesion} />
      <p className="muted">Cargando...</p>
    </div>
  );

  return (
    <div className="contenedor contenedor-ancho">
      <CabeceraApp pestanaActiva="colaboradores" cerrarSesion={cerrarSesion} />
      <div className="fila" style={{ marginTop: 16 }}>
        <div>
          <h1 className="titulo-pagina" style={{ margin: 0 }}>{lote.evento}</h1>
          <p className="muted" style={{ margin: 0 }}>{lote.colaborador_nombre} · {lote.trimestre_id}</p>
        </div>
        <a href="/"><button className="secundario">Volver</button></a>
      </div>

      <TablaCuentas
        lote={lote}
        facturas={facturas}
        pagos={pagos}
        totales={totales}
        onGuardarFactura={(facturaId, campos) => guardarFactura(facturaId, campos, { mensajeOk: 'Guardado' })}
        onSolicitarRechazo={setARechazar}
        onSolicitarBorrado={setABorrar}
        movimientos={movimientos}
        onVincular={vincularPago}
        onCrearPago={crearPago}
      />

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
        mensaje="No se elimina del histórico, pero desaparece de las cuentas."
        textoConfirmar="Borrar"
        peligroso
        onConfirmar={confirmarBorrado}
        onCancelar={() => setABorrar(null)}
      />
    </div>
  );
}
