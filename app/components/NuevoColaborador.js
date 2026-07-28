'use client';

import { useState } from 'react';

export default function NuevoColaborador({ onCreado }) {
  const [nombre, setNombre] = useState('');
  const [usuario, setUsuario] = useState('');
  const [passwordGenerada, setPasswordGenerada] = useState(null);

  async function crear(e) {
    e.preventDefault();
    const res = await fetch('/api/colaboradores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre, usuario }),
    });
    const data = await res.json();
    if (res.ok) {
      setPasswordGenerada({ usuario: data.colaborador.usuario, password: data.colaborador.password });
      setNombre('');
      setUsuario('');
      if (onCreado) onCreado();
    }
  }

  return (
    <div>
      <strong>Nuevo colaborador</strong>
      <div style={{ height: 8 }} />
      <form onSubmit={crear}>
        <input type="text" placeholder="Nombre" value={nombre} onChange={e => setNombre(e.target.value)} />
        <div style={{ height: 8 }} />
        <input type="text" placeholder="Usuario (para iniciar sesión)" value={usuario} onChange={e => setUsuario(e.target.value)} />
        <div style={{ height: 8 }} />
        <button type="submit">Crear colaborador</button>
      </form>
      {passwordGenerada && (
        <p className="muted" style={{ marginTop: 8 }}>
          Usuario: <strong>{passwordGenerada.usuario}</strong> · Contraseña: <strong>{passwordGenerada.password}</strong>
          <br />Apúntala ahora — no se puede volver a ver.
        </p>
      )}
    </div>
  );
}
