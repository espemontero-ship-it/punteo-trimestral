'use client';

import { useEffect, useState, useCallback } from 'react';
import { ConfirmDialog } from './ConfirmDialog';
import { apiFetch } from '../lib/toast';

export default function SelectorTrimestre({ onEntrar }) {
  const [trimestres, setTrimestres] = useState(null);
  const [nuevoId, setNuevoId] = useState('');
  const [creando, setCreando] = useState(false);
  const [aBorrar, setABorrar] = useState(null);

  const cargar = useCallback(async () => {
    const r = await apiFetch('/api/trimestres', undefined, { mensajeError: 'No se pudo cargar la lista de trimestres.' });
    setTrimestres((r && r.trimestres) || []);
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  async function crear(e) {
    e.preventDefault();
    const id = nuevoId.trim();
    if (!id) return;
    setCreando(true);
    try {
      const r = await apiFetch('/api/trimestres', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      }, { mensajeError: 'No se pudo crear el trimestre.' });
      if (r) onEntrar(id);
    } finally {
      setCreando(false);
    }
  }

  async function confirmarBorrado() {
    const id = aBorrar;
    setABorrar(null);
    const r = await apiFetch(`/api/trimestres/${id}`, { method: 'DELETE' }, {
      mensajeOk: `Trimestre "${id}" borrado.`,
      mensajeError: 'No se pudo borrar el trimestre.',
    });
    if (r) cargar();
  }

  return (
    <div className="contenedor" style={{ paddingTop: '8vh' }}>
      <div className="tarjeta">
        <h1 style={{ marginTop: 0 }}>Punteo trimestral</h1>

        {trimestres === null && <p className="muted">Cargando trimestres...</p>}

        {trimestres && trimestres.length > 0 && (
          <>
            <p className="muted">Trimestres existentes:</p>
            {trimestres.map(t => {
              const total = Number(t.total);
              const resueltas = Number(t.resueltas);
              return (
                <div
                  key={t.id}
                  className="tarjeta fila"
                  style={{ cursor: 'pointer', background: 'rgba(255,255,255,0.03)' }}
                  onClick={() => onEntrar(t.id)}
                >
                  <div>
                    <strong>{t.id}</strong>{t.cerrado ? <span className="etiqueta pedida" style={{ marginLeft: 8 }}>cerrado</span> : null}
                    <div className="muted">{total > 0 ? `${resueltas}/${total} resueltas` : 'sin movimientos todavía'}</div>
                  </div>
                  <button className="secundario" onClick={e => { e.stopPropagation(); setABorrar(t.id); }}>🗑</button>
                </div>
              );
            })}
          </>
        )}

        {trimestres && trimestres.length === 0 && (
          <p className="muted">Todavía no hay ningún trimestre.</p>
        )}

        <div style={{ height: 12 }} />
        <form onSubmit={crear}>
          <input
            type="text"
            placeholder="ej. 2026-Q3, o test-lo-que-sea"
            value={nuevoId}
            onChange={e => setNuevoId(e.target.value)}
          />
          <div style={{ height: 12 }} />
          <button className="grande" type="submit" disabled={creando}>
            {creando ? 'Creando...' : '+ Crear / entrar'}
          </button>
        </form>
      </div>

      <ConfirmDialog
        abierto={!!aBorrar}
        titulo={`¿Borrar el trimestre "${aBorrar}"?`}
        mensaje="Se borran sus movimientos y facturas. No se puede deshacer."
        textoConfirmar="Borrar"
        peligroso
        onConfirmar={confirmarBorrado}
        onCancelar={() => setABorrar(null)}
      />
    </div>
  );
}
