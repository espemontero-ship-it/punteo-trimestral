'use client';

import { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';

export default function InvitacionPage({ params }) {
  const { token } = use(params);
  const [invitacion, setInvitacion] = useState(undefined); // undefined = cargando, null = inválida
  const [password, setPassword] = useState('');
  const [confirmar, setConfirmar] = useState('');
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const router = useRouter();

  useEffect(() => {
    fetch(`/api/invitaciones/${token}`)
      .then(res => res.ok ? res.json() : null)
      .then(setInvitacion);
  }, [token]);

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    if (password !== confirmar) {
      setError('The two passwords don\'t match.');
      return;
    }
    setEnviando(true);
    try {
      const res = await fetch(`/api/invitaciones/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Could not create the account.');
        return;
      }
      router.push(data.redirect || '/colaborador');
      router.refresh();
    } finally {
      setEnviando(false);
    }
  }

  if (invitacion === undefined) {
    return <div className="contenedor" style={{ paddingTop: '20vh' }}><p className="muted">Loading...</p></div>;
  }

  if (!invitacion) {
    return (
      <div className="contenedor" style={{ paddingTop: '20vh' }}>
        <div className="tarjeta">
          <h1 style={{ marginTop: 0 }}>Invalid link</h1>
          <p className="muted">This invitation link has expired or was already used. Ask to be invited again.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="contenedor" style={{ paddingTop: '20vh' }}>
      <div className="tarjeta">
        <h1 style={{ marginTop: 0 }}>Hi, {invitacion.nombre}</h1>
        <p className="muted">
          {invitacion.proyecto
            ? <>You've been invited to upload invoices for <strong>{invitacion.proyecto}</strong>.</>
            : "You've been invited to upload invoices for NotOnlyLarp."}
          {' '}Choose your password:
        </p>
        <form onSubmit={onSubmit}>
          <input
            type="password"
            placeholder="Password"
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
            {enviando ? 'Creating account...' : 'Create my account'}
          </button>
          {error && <p className="error">{error}</p>}
        </form>
      </div>
    </div>
  );
}
