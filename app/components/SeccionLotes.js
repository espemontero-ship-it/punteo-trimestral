'use client';

import { useEffect, useState, useCallback } from 'react';
import NuevoColaborador from './NuevoColaborador';

// Colaboradores sigue teniendo trimestre por lote (se rediseña como módulo
// aparte más adelante, ver PROYECTO.md) -- el resto de la app ya no tiene un
// "trimestre actual" seleccionado, así que aquí se listan todos los lotes
// juntos (con su trimestre visible en cada tarjeta) y se pide el trimestre
// a mano solo al crear uno nuevo.
export default function SeccionLotes() {
  const [colaboradores, setColaboradores] = useState([]);
  const [lotes, setLotes] = useState([]);
  const [nuevoLote, setNuevoLote] = useState({ trimestreId: '', colaboradorId: '', evento: '' });

  const cargar = useCallback(async () => {
    const [rc, rl] = await Promise.all([
      fetch('/api/colaboradores').then(r => r.json()),
      fetch('/api/lotes').then(r => r.json()),
    ]);
    setColaboradores(rc.colaboradores || []);
    setLotes(rl.lotes || []);
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  async function crearLote(e) {
    e.preventDefault();
    if (!nuevoLote.trimestreId || !nuevoLote.colaboradorId || !nuevoLote.evento) return;
    await fetch('/api/lotes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(nuevoLote),
    });
    setNuevoLote({ trimestreId: '', colaboradorId: '', evento: '' });
    cargar();
  }

  return (
    <>
      <div className="tarjeta">
        <strong>Colaboradores y lotes de gastos</strong>
        <p className="muted">Para gente del equipo que compra en eventos y tú les reembolsas — suben sus facturas, tú las revisas y generas los pagos.</p>

        {lotes.map(l => (
          <a key={l.id} href={`/lotes/${l.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
            <div className="tarjeta fila" style={{ background: 'rgba(255,255,255,0.03)', cursor: 'pointer' }}>
              <div>
                <strong>{l.evento}</strong> — {l.colaborador_nombre}
                <div className="muted">
                  {l.trimestre_id} · {Number(l.total_subido).toFixed(2)}€ subidas · {Number(l.total_aceptado).toFixed(2)}€ aceptadas
                </div>
              </div>
            </div>
          </a>
        ))}

        <details style={{ marginTop: 12 }}>
          <summary style={{ cursor: 'pointer' }}>+ Nuevo lote</summary>
          <form onSubmit={crearLote} style={{ marginTop: 8 }}>
            <input
              type="text"
              placeholder="Trimestre (ej. 2026-Q3)"
              value={nuevoLote.trimestreId}
              onChange={e => setNuevoLote({ ...nuevoLote, trimestreId: e.target.value })}
            />
            <div style={{ height: 8 }} />
            <select
              value={nuevoLote.colaboradorId}
              onChange={e => setNuevoLote({ ...nuevoLote, colaboradorId: e.target.value })}
            >
              <option value="">Elige colaborador...</option>
              {colaboradores.map(c => <option key={c.id} value={c.id}>{c.nombre} ({c.usuario})</option>)}
            </select>
            <div style={{ height: 8 }} />
            <input
              type="text"
              placeholder="Evento (ej. Wield #3)"
              value={nuevoLote.evento}
              onChange={e => setNuevoLote({ ...nuevoLote, evento: e.target.value })}
            />
            <div style={{ height: 8 }} />
            <button type="submit">Crear lote</button>
          </form>
        </details>
      </div>

      <div className="tarjeta">
        <NuevoColaborador onCreado={cargar} />
      </div>
    </>
  );
}
