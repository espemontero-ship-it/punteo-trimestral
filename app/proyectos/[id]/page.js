'use client';

import { useEffect, useState, useCallback, use } from 'react';
import CabeceraApp from '../../components/CabeceraApp';
import { apiFetch } from '../../lib/toast';

async function cerrarSesion() {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/login';
}

const COLS_DEVOLUCIONES = '130px 100px 1fr 1fr';
const COLS_FACTURAS_FUTURAS = '130px 100px 160px 1fr';
const COLS_FACTURAS_LOTE = '1fr 1fr 100px 120px';

export default function ProyectoPage({ params }) {
  const { id } = use(params);
  const [proyecto, setProyecto] = useState(null);
  const [devoluciones, setDevoluciones] = useState(null);
  const [facturasFuturas, setFacturasFuturas] = useState(null);
  const [facturasLote, setFacturasLote] = useState(null);

  const cargar = useCallback(async () => {
    const [rp, r, rf, rl] = await Promise.all([
      apiFetch('/api/proyectos', undefined, { mensajeError: 'No se pudo cargar el proyecto.' }),
      apiFetch(`/api/proyectos/${id}/devoluciones`, undefined, { mensajeError: 'No se pudo obtener la lista de devoluciones.' }),
      apiFetch(`/api/proyectos/${id}/facturas-futuras`, undefined, { mensajeError: 'No se pudo obtener la lista de facturas futuras.' }),
      apiFetch(`/api/proyectos/${id}/facturas-lote`, undefined, { mensajeError: 'No se pudo obtener la lista de facturas de colaboradores.' }),
    ]);
    setProyecto((rp && rp.proyectos || []).find(p => String(p.id) === String(id)) || null);
    setDevoluciones((r && r.devoluciones) || []);
    setFacturasFuturas((rf && rf.facturas) || []);
    setFacturasLote((rl && rl.facturas) || []);
  }, [id]);

  useEffect(() => { cargar(); }, [cargar]);

  function descargarCsv() {
    if (!devoluciones || devoluciones.length === 0) return;
    const escapar = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const filas = [
      ['Fecha', 'Importe', 'Jugador (LarpManager)', 'Nota'].map(escapar).join(','),
      ...devoluciones.map(d => [
        d.fecha ? new Date(d.fecha).toLocaleDateString('es-ES') : '',
        Number(d.importe).toFixed(2),
        d.jugador_larpmanager,
        d.nota_final,
      ].map(escapar).join(',')),
    ];
    const blob = new Blob(['﻿' + filas.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `devoluciones-${proyecto.nombre}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!proyecto) return (
    <div className="contenedor contenedor-ancho">
      <CabeceraApp pestanaActiva="proyectos" cerrarSesion={cerrarSesion} />
      <p className="muted">Cargando...</p>
    </div>
  );

  return (
    <div className="contenedor contenedor-ancho">
      <CabeceraApp pestanaActiva="proyectos" cerrarSesion={cerrarSesion} />
      <div className="fila" style={{ marginTop: 16 }}>
        <div>
          <h1 style={{ margin: 0 }}>{proyecto.nombre}</h1>
          <p className="muted" style={{ margin: 0 }}>Pendientes de cierre</p>
        </div>
        <a href="/"><button className="secundario">Volver</button></a>
      </div>

      <div style={{ marginTop: 24 }}>
        <p style={{ fontWeight: 600, marginBottom: 4 }}>Devoluciones</p>
        <p className="muted" style={{ marginTop: 0 }}>De cualquier fecha — para el cierre de proyecto.</p>
        {devoluciones && devoluciones.length === 0 && <p className="muted">Ninguna devolución de este proyecto todavía.</p>}
        {devoluciones && devoluciones.length > 0 && (
          <>
            <button type="button" className="secundario" style={{ marginBottom: 8 }} onClick={descargarCsv}>Descargar CSV</button>
            <div className="tabla-movimientos-envoltura" role="table">
              <div role="rowgroup">
                <div role="row" className="fila-tabla-cabecera" style={{ gridTemplateColumns: COLS_DEVOLUCIONES }}>
                  <div role="columnheader" className="celda">Fecha</div>
                  <div role="columnheader" className="celda">Importe</div>
                  <div role="columnheader" className="celda">Jugador (LarpManager)</div>
                  <div role="columnheader" className="celda">Nota</div>
                </div>
              </div>
              <div role="rowgroup">
                {devoluciones.map(d => (
                  <div role="row" key={d.id} className="fila-tabla" style={{ gridTemplateColumns: COLS_DEVOLUCIONES }}>
                    <div role="cell" className="celda">{d.fecha ? new Date(d.fecha).toLocaleDateString('es-ES') : '—'}</div>
                    <div role="cell" className="celda">{Number(d.importe).toFixed(2)}€</div>
                    <div role="cell" className="celda">{d.jugador_larpmanager || '—'}</div>
                    <div role="cell" className="celda muted">{d.nota_final || '—'}</div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      <div style={{ marginTop: 24 }}>
        <p style={{ fontWeight: 600, marginBottom: 4 }}>Facturas futuras sin recuperar</p>
        <p className="muted" style={{ marginTop: 0 }}>Proveedores que no emiten factura hasta que ha pasado el servicio (ej. DoYouSpain, Iberia) — mientras el proyecto siga abierto, siguen pendientes de pedir.</p>
        {facturasFuturas && facturasFuturas.length === 0 && <p className="muted">Ninguna factura futura pendiente de este proyecto.</p>}
        {facturasFuturas && facturasFuturas.length > 0 && (
          <div className="tabla-movimientos-envoltura" role="table">
            <div role="rowgroup">
              <div role="row" className="fila-tabla-cabecera" style={{ gridTemplateColumns: COLS_FACTURAS_FUTURAS }}>
                <div role="columnheader" className="celda">Fecha</div>
                <div role="columnheader" className="celda">Importe</div>
                <div role="columnheader" className="celda">Proveedor</div>
                <div role="columnheader" className="celda">Concepto</div>
              </div>
            </div>
            <div role="rowgroup">
              {facturasFuturas.map(f => (
                <div role="row" key={f.id} className="fila-tabla" style={{ gridTemplateColumns: COLS_FACTURAS_FUTURAS }}>
                  <div role="cell" className="celda">{f.fecha ? new Date(f.fecha).toLocaleDateString('es-ES') : '—'}</div>
                  <div role="cell" className="celda">{Number(f.importe).toFixed(2)}€</div>
                  <div role="cell" className="celda">{f.proveedor || '—'}</div>
                  <div role="cell" className="celda muted">{f.concepto?.slice(0, 60) || '—'}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div style={{ marginTop: 24 }}>
        <p style={{ fontWeight: 600, marginBottom: 4 }}>Facturas de colaboradores pendientes</p>
        <p className="muted" style={{ marginTop: 0 }}>De cualquier lote de este proyecto, todavía sin revisar o revisadas pero sin cerrar.</p>
        {facturasLote && facturasLote.length === 0 && <p className="muted">Ninguna factura de colaborador pendiente de este proyecto.</p>}
        {facturasLote && facturasLote.length > 0 && (
          <div className="tabla-movimientos-envoltura" role="table">
            <div role="rowgroup">
              <div role="row" className="fila-tabla-cabecera" style={{ gridTemplateColumns: COLS_FACTURAS_LOTE }}>
                <div role="columnheader" className="celda">Colaborador</div>
                <div role="columnheader" className="celda">Concepto</div>
                <div role="columnheader" className="celda">Importe</div>
                <div role="columnheader" className="celda">Estado</div>
              </div>
            </div>
            <div role="rowgroup">
              {facturasLote.map(f => (
                <div role="row" key={f.id} className="fila-tabla" style={{ gridTemplateColumns: COLS_FACTURAS_LOTE }}>
                  <div role="cell" className="celda">{f.colaborador_nombre}</div>
                  <div role="cell" className="celda muted">{f.concepto?.slice(0, 60) || '—'}</div>
                  <div role="cell" className="celda">{f.importe_declarado != null ? `${Number(f.importe_declarado).toFixed(2)}€` : '—'}</div>
                  <div role="cell" className="celda">{f.estado_revision === 'aceptada' ? 'Aceptada' : 'Sin revisar'}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
