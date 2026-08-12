'use client';

import { useEffect, useState, useCallback, use } from 'react';
import { apiFetch } from '../../lib/toast';

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

  if (!proyecto) return <div className="contenedor"><p className="muted">Cargando...</p></div>;

  return (
    <div className="contenedor contenedor-ancho">
      <div className="fila" style={{ marginTop: 16 }}>
        <div>
          <h1 style={{ margin: 0 }}>{proyecto.nombre}</h1>
          <p className="muted" style={{ margin: 0 }}>Pendientes de cierre</p>
        </div>
        <a href="/"><button className="secundario">Volver</button></a>
      </div>

      <div className="tarjeta">
        <p style={{ fontWeight: 600, marginBottom: 4 }}>Devoluciones</p>
        <p className="muted" style={{ marginTop: 0 }}>De cualquier fecha — para el cierre de proyecto.</p>
        {devoluciones && devoluciones.length === 0 && <p className="muted">Ninguna devolución de este proyecto todavía.</p>}
        {devoluciones && devoluciones.length > 0 && (
          <>
            <button type="button" className="secundario" style={{ marginBottom: 8 }} onClick={descargarCsv}>Descargar CSV</button>
            <table style={{ width: '100%', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left' }}>
                  <th>Fecha</th>
                  <th>Importe</th>
                  <th>Jugador (LarpManager)</th>
                  <th>Nota</th>
                </tr>
              </thead>
              <tbody>
                {devoluciones.map(d => (
                  <tr key={d.id}>
                    <td>{d.fecha ? new Date(d.fecha).toLocaleDateString('es-ES') : '—'}</td>
                    <td>{Number(d.importe).toFixed(2)}€</td>
                    <td>{d.jugador_larpmanager || '—'}</td>
                    <td>{d.nota_final || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

      <div className="tarjeta">
        <p style={{ fontWeight: 600, marginBottom: 4 }}>Facturas futuras sin recuperar</p>
        <p className="muted" style={{ marginTop: 0 }}>Proveedores que no emiten factura hasta que ha pasado el servicio (ej. DoYouSpain, Iberia) — mientras el proyecto siga abierto, siguen pendientes de pedir.</p>
        {facturasFuturas && facturasFuturas.length === 0 && <p className="muted">Ninguna factura futura pendiente de este proyecto.</p>}
        {facturasFuturas && facturasFuturas.length > 0 && (
          <table style={{ width: '100%', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left' }}>
                <th>Fecha</th>
                <th>Importe</th>
                <th>Proveedor</th>
                <th>Concepto</th>
              </tr>
            </thead>
            <tbody>
              {facturasFuturas.map(f => (
                <tr key={f.id}>
                  <td>{f.fecha ? new Date(f.fecha).toLocaleDateString('es-ES') : '—'}</td>
                  <td>{Number(f.importe).toFixed(2)}€</td>
                  <td>{f.proveedor || '—'}</td>
                  <td className="muted">{f.concepto?.slice(0, 60) || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="tarjeta">
        <p style={{ fontWeight: 600, marginBottom: 4 }}>Facturas de colaboradores pendientes</p>
        <p className="muted" style={{ marginTop: 0 }}>De cualquier lote de este proyecto, todavía sin revisar o revisadas pero sin cerrar.</p>
        {facturasLote && facturasLote.length === 0 && <p className="muted">Ninguna factura de colaborador pendiente de este proyecto.</p>}
        {facturasLote && facturasLote.length > 0 && (
          <table style={{ width: '100%', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left' }}>
                <th>Colaborador</th>
                <th>Concepto</th>
                <th>Importe</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {facturasLote.map(f => (
                <tr key={f.id}>
                  <td>{f.colaborador_nombre}</td>
                  <td className="muted">{f.concepto?.slice(0, 60) || '—'}</td>
                  <td>{f.importe_declarado != null ? `${Number(f.importe_declarado).toFixed(2)}€` : '—'}</td>
                  <td>{f.estado_revision === 'aceptada' ? 'Aceptada' : 'Sin revisar'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
