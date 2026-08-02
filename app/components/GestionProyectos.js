'use client';

import { useState } from 'react';
import { apiFetch } from '../lib/toast';
import { Modal } from './Modal';

export default function GestionProyectos({ proyectos, onCambio }) {
  const [nombre, setNombre] = useState('');
  const [creando, setCreando] = useState(false);
  const [proyectoDevoluciones, setProyectoDevoluciones] = useState(null); // proyecto | null
  const [devoluciones, setDevoluciones] = useState(null);
  const [cargandoDevoluciones, setCargandoDevoluciones] = useState(false);

  // Un proyecto puede abarcar varios trimestres -- al cerrarlo hace falta ver
  // todas sus devoluciones aunque estén repartidas entre varios, no solo el actual.
  async function verDevoluciones(proyecto) {
    setProyectoDevoluciones(proyecto);
    setCargandoDevoluciones(true);
    const r = await apiFetch(`/api/proyectos/${proyecto.id}/devoluciones`, undefined, {
      mensajeError: 'No se pudo obtener la lista de devoluciones.',
    });
    setDevoluciones((r && r.devoluciones) || []);
    setCargandoDevoluciones(false);
  }

  function descargarCsv() {
    if (!devoluciones || devoluciones.length === 0) return;
    const escapar = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const filas = [
      ['Trimestre', 'Fecha', 'Importe', 'Jugador (LarpManager)', 'Nota'].map(escapar).join(','),
      ...devoluciones.map(d => [
        d.trimestre_id,
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
    a.download = `devoluciones-${proyectoDevoluciones.nombre}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function crear(e) {
    e.preventDefault();
    if (!nombre.trim()) return;
    setCreando(true);
    try {
      const r = await apiFetch('/api/proyectos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre: nombre.trim() }),
      }, { mensajeOk: 'Proyecto creado', mensajeError: 'No se pudo crear el proyecto.' });
      if (r) {
        setNombre('');
        onCambio();
      }
    } finally {
      setCreando(false);
    }
  }

  return (
    <div className="tarjeta">
      <strong>Proyectos</strong>
      <p className="muted">Lista fija reutilizada entre trimestres — al puntear una línea del banco, se puede asignar a uno de estos.</p>
      {proyectos.length === 0 && <p className="muted">Todavía no hay ningún proyecto creado.</p>}
      {proyectos.map(p => (
        <div key={p.id} className="fila" style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
          <span>{p.nombre}</span>
          <button type="button" className="secundario" onClick={() => verDevoluciones(p)}>Ver devoluciones</button>
        </div>
      ))}
      <form onSubmit={crear} style={{ marginTop: 12 }}>
        <div className="fila">
          <input
            type="text"
            placeholder="Nombre del proyecto (ej. Wield 2)"
            value={nombre}
            onChange={e => setNombre(e.target.value)}
          />
          <button type="submit" disabled={creando}>{creando ? 'Creando...' : 'Crear'}</button>
        </div>
      </form>

      <Modal abierto={!!proyectoDevoluciones} titulo={`Devoluciones — ${proyectoDevoluciones?.nombre || ''}`} onCerrar={() => setProyectoDevoluciones(null)}>
        <p className="muted">Todas las devoluciones de este proyecto, en cualquier trimestre — para el cierre de proyecto.</p>
        {cargandoDevoluciones && <p className="muted">Cargando...</p>}
        {!cargandoDevoluciones && devoluciones && devoluciones.length === 0 && (
          <p className="muted">Ninguna devolución de este proyecto todavía.</p>
        )}
        {!cargandoDevoluciones && devoluciones && devoluciones.length > 0 && (
          <>
            <button type="button" className="secundario" style={{ marginBottom: 8 }} onClick={descargarCsv}>Descargar CSV</button>
            <table style={{ width: '100%', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left' }}>
                  <th>Trimestre</th>
                  <th>Fecha</th>
                  <th>Importe</th>
                  <th>Jugador (LarpManager)</th>
                  <th>Nota</th>
                </tr>
              </thead>
              <tbody>
                {devoluciones.map(d => (
                  <tr key={d.id}>
                    <td>{d.trimestre_id}</td>
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
      </Modal>
    </div>
  );
}
