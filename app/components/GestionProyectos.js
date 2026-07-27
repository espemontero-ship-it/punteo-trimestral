'use client';

import { useState } from 'react';
import { apiFetch } from '../lib/toast';

export default function GestionProyectos({ proyectos, onCambio }) {
  const [nombre, setNombre] = useState('');
  const [creando, setCreando] = useState(false);

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
        <div key={p.id} style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>{p.nombre}</div>
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
    </div>
  );
}
