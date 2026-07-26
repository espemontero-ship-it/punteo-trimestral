'use client';

import { useEffect, useState, useCallback } from 'react';

export default function SeccionLotes({ trimestreId }) {
  const [colaboradores, setColaboradores] = useState([]);
  const [lotes, setLotes] = useState([]);
  const [nuevoColaborador, setNuevoColaborador] = useState({ nombre: '', usuario: '' });
  const [passwordGenerada, setPasswordGenerada] = useState(null);
  const [nuevoLote, setNuevoLote] = useState({ colaboradorId: '', evento: '' });

  const cargar = useCallback(async () => {
    const [rc, rl] = await Promise.all([
      fetch('/api/colaboradores').then(r => r.json()),
      fetch(`/api/trimestres/${trimestreId}/lotes`).then(r => r.json()),
    ]);
    setColaboradores(rc.colaboradores || []);
    setLotes(rl.lotes || []);
  }, [trimestreId]);

  useEffect(() => { cargar(); }, [cargar]);

  async function crearColaborador(e) {
    e.preventDefault();
    const res = await fetch('/api/colaboradores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(nuevoColaborador),
    });
    const data = await res.json();
    if (res.ok) {
      setPasswordGenerada({ usuario: data.colaborador.usuario, password: data.colaborador.password });
      setNuevoColaborador({ nombre: '', usuario: '' });
      cargar();
    }
  }

  async function crearLote(e) {
    e.preventDefault();
    if (!nuevoLote.colaboradorId || !nuevoLote.evento) return;
    await fetch(`/api/trimestres/${trimestreId}/lotes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(nuevoLote),
    });
    setNuevoLote({ colaboradorId: '', evento: '' });
    cargar();
  }

  return (
    <div className="tarjeta">
      <strong>Colaboradores y lotes de gastos</strong>
      <p className="muted">Para gente del equipo que compra en eventos y tú les reembolsas — suben sus facturas, tú las revisas y generas los pagos.</p>

      {lotes.map(l => (
        <a key={l.id} href={`/lotes/${l.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
          <div className="tarjeta fila" style={{ background: 'rgba(255,255,255,0.03)', cursor: 'pointer' }}>
            <div>
              <strong>{l.evento}</strong> — {l.colaborador_nombre}
              <div className="muted">
                {Number(l.total_subido).toFixed(2)}€ subidas · {Number(l.total_aceptado).toFixed(2)}€ aceptadas
              </div>
            </div>
          </div>
        </a>
      ))}

      <details style={{ marginTop: 12 }}>
        <summary style={{ cursor: 'pointer' }}>+ Nuevo lote</summary>
        <form onSubmit={crearLote} style={{ marginTop: 8 }}>
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

      <details style={{ marginTop: 12 }}>
        <summary style={{ cursor: 'pointer' }}>+ Nuevo colaborador</summary>
        <form onSubmit={crearColaborador} style={{ marginTop: 8 }}>
          <input
            type="text"
            placeholder="Nombre"
            value={nuevoColaborador.nombre}
            onChange={e => setNuevoColaborador({ ...nuevoColaborador, nombre: e.target.value })}
          />
          <div style={{ height: 8 }} />
          <input
            type="text"
            placeholder="Usuario (para iniciar sesión)"
            value={nuevoColaborador.usuario}
            onChange={e => setNuevoColaborador({ ...nuevoColaborador, usuario: e.target.value })}
          />
          <div style={{ height: 8 }} />
          <button type="submit">Crear colaborador</button>
        </form>
        {passwordGenerada && (
          <p className="muted" style={{ marginTop: 8 }}>
            Usuario: <strong>{passwordGenerada.usuario}</strong> · Contraseña: <strong>{passwordGenerada.password}</strong>
            <br />Apúntala ahora — no se puede volver a ver.
          </p>
        )}
      </details>
    </div>
  );
}
