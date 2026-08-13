'use client';

import { useState, use } from 'react';

export default function RestablecerPage({ params }) {
  const { token } = use(params);
  const [password, setPassword] = useState('');
  const [confirmar, setConfirmar] = useState('');
  const [error, setError] = useState(null);
  const [hecho, setHecho] = useState(false);
  const [enviando, setEnviando] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    if (password !== confirmar) {
      setError("The two passwords don't match.");
      return;
    }
    setEnviando(true);
    try {
      const res = await fetch(`/api/restablecer/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Could not change the password.');
        return;
      }
      setHecho(true);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="contenedor" style={{ paddingTop: '20vh' }}>
      <div className="tarjeta">
        <h1 style={{ marginTop: 0 }}>Choose a new password</h1>
        {hecho ? (
          <p className="muted">Password changed. You can now <a href="/login">log in</a> with it.</p>
        ) : (
          <form onSubmit={onSubmit}>
            <input
              type="password"
              placeholder="New password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete="new-password"
            />
            <div style={{ height: 12 }} />
            <input
              type="password"
              placeholder="Repeat the password"
              value={confirmar}
              onChange={e => setConfirmar(e.target.value)}
              autoComplete="new-password"
            />
            <div style={{ height: 12 }} />
            <button className="grande" type="submit" disabled={enviando}>
              {enviando ? 'Saving...' : 'Save password'}
            </button>
            {error && <p className="error">{error}</p>}
          </form>
        )}
      </div>
    </div>
  );
}
