'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [usuario, setUsuario] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const router = useRouter();

  async function onSubmit(e) {
    e.preventDefault();
    setEnviando(true);
    setError(null);
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usuario: usuario.trim() || undefined, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Could not log in');
        return;
      }
      router.push(data.redirect || '/');
      router.refresh();
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="contenedor" style={{ paddingTop: '20vh' }}>
      <div className="tarjeta">
        <h1 style={{ marginTop: 0 }}>Punteo trimestral</h1>
        <form onSubmit={onSubmit}>
          <input
            type="text"
            placeholder="Email"
            value={usuario}
            onChange={e => setUsuario(e.target.value)}
            autoComplete="username"
          />
          <div style={{ height: 12 }} />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoComplete="current-password"
          />
          <div style={{ height: 12 }} />
          <button className="grande" type="submit" disabled={enviando}>
            {enviando ? 'Logging in...' : 'Log in'}
          </button>
          {error && <p className="error">{error}</p>}
          <p className="muted" style={{ marginTop: 12 }}>
            <a href="/recuperar">Forgot your password?</a>
          </p>
        </form>
      </div>
    </div>
  );
}
