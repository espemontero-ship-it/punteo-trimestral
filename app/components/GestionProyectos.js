'use client';

import { useState } from 'react';
import { apiFetch } from '../lib/toast';
import { Modal } from './Modal';

export default function GestionProyectos({ proyectos, onCambio }) {
  const [nombre, setNombre] = useState('');
  const [creando, setCreando] = useState(false);
  const [modalAbierto, setModalAbierto] = useState(false);

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
        setModalAbierto(false);
        onCambio();
      }
    } finally {
      setCreando(false);
    }
  }

  return (
    <div>
      <div className="fila" style={{ marginBottom: 8 }}>
        <div>
          <strong>Proyectos</strong>
          <p className="muted" style={{ margin: '4px 0 0' }}>Lista fija reutilizada entre trimestres — al puntear un movimiento, se puede asignar a uno de estos.</p>
        </div>
        <button type="button" className="secundario" onClick={() => setModalAbierto(true)}>+ Añadir proyecto</button>
      </div>
      {proyectos.length === 0 && <p className="muted">Todavía no hay ningún proyecto creado.</p>}
      {proyectos.length > 0 && (
        <div className="tabla-movimientos-envoltura" role="table" style={{ marginTop: 8 }}>
          <div role="rowgroup">
            <div role="row" className="fila-tabla-cabecera" style={{ gridTemplateColumns: '1fr' }}>
              <div role="columnheader" className="celda">Nombre</div>
            </div>
          </div>
          <div role="rowgroup">
            {proyectos.map(p => (
              <div key={p.id} role="row" className="fila-tabla" style={{ gridTemplateColumns: '1fr' }}>
                <div role="cell" className="celda"><a href={`/proyectos/${p.id}`} style={{ color: 'inherit' }}>{p.nombre}</a></div>
              </div>
            ))}
          </div>
        </div>
      )}

      <Modal abierto={modalAbierto} titulo="Añadir proyecto" onCerrar={() => setModalAbierto(false)}>
        <form onSubmit={crear}>
          <div style={{ marginBottom: 14 }}>
            <span className="etiqueta">Nombre</span>
            <input
              type="text"
              placeholder="Ej. Wield 2"
              value={nombre}
              onChange={e => setNombre(e.target.value)}
            />
          </div>
          <p className="dialogo-cuerpo" style={{ marginBottom: 14 }}>
            Se reutiliza entre trimestres — al puntear un movimiento, se podrá asignar a este proyecto.
          </p>
          <button type="submit" className="secundario" style={{ width: '100%' }} disabled={creando}>
            {creando ? 'Creando...' : 'Crear'}
          </button>
        </form>
      </Modal>
    </div>
  );
}
