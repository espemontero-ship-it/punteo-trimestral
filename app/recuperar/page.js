'use client';

import { useState } from 'react';

export default function RecuperarPage() {
  const [usuario, setUsuario] = useState('');
  const [mensaje, setMensaje] = useState(null);
  const [enviando, setEnviando] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setEnviando(true);
    try {
      const res = await fetch('/api/recuperar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usuario: usuario.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      setMensaje(data.mensaje || "If that email has an account, you'll get a link.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="contenedor" style={{ paddingTop: '20vh' }}>
      <div className="tarjeta">
        <h1 style={{ marginTop: 0 }}>Reset password</h1>
        {mensaje ? (
          <p className="muted">{mensaje}</p>
        ) : (
          <form onSubmit={onSubmit}>
            <input
              type="text"
              placeholder="Your email"
              value={usuario}
              onChange={e => setUsuario(e.target.value)}
              autoComplete="username"
            />
            <div style={{ height: 12 }} />
            <button className="grande" type="submit" disabled={enviando}>
              {enviando ? 'Sending...' : 'Send link'}
            </button>
          </form>
        )}
        <p className="muted" style={{ marginTop: 12 }}>
          <a href="/login">Back to login</a>
        </p>
      </div>
    </div>
  );
}
