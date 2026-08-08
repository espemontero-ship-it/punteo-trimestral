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
      setError('Las dos contraseñas no coinciden.');
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
        setError(data.error || 'No se pudo completar el alta.');
        return;
      }
      router.push(data.redirect || '/colaborador');
      router.refresh();
    } finally {
      setEnviando(false);
    }
  }

  if (invitacion === undefined) {
    return <div className="contenedor" style={{ paddingTop: '20vh' }}><p className="muted">Cargando...</p></div>;
  }

  if (!invitacion) {
    return (
      <div className="contenedor" style={{ paddingTop: '20vh' }}>
        <div className="tarjeta">
          <h1 style={{ marginTop: 0 }}>Enlace no válido</h1>
          <p className="muted">Este enlace de invitación ya ha caducado o ya se usó. Pide que te inviten de nuevo.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="contenedor" style={{ paddingTop: '20vh' }}>
      <div className="tarjeta">
        <h1 style={{ marginTop: 0 }}>Hola, {invitacion.nombre}</h1>
        <p className="muted">Te han invitado a subir facturas de <strong>{invitacion.proyecto}</strong>. Elige tu contraseña:</p>
        <form onSubmit={onSubmit}>
          <input
            type="password"
            placeholder="Contraseña"
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoComplete="new-password"
          />
          <div style={{ height: 12 }} />
          <input
            type="password"
            placeholder="Repite la contraseña"
            value={confirmar}
            onChange={e => setConfirmar(e.target.value)}
            autoComplete="new-password"
          />
          <div style={{ height: 12 }} />
          <button className="grande" type="submit" disabled={enviando}>
            {enviando ? 'Creando cuenta...' : 'Crear mi cuenta'}
          </button>
          {error && <p className="error">{error}</p>}
        </form>
      </div>
    </div>
  );
}
