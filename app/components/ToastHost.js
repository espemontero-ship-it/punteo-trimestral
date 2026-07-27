'use client';

import { useEffect, useState } from 'react';
import { suscribirToast } from '../lib/toast';

export default function ToastHost() {
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    return suscribirToast(evento => {
      setToasts(prev => [...prev, evento]);
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== evento.id));
      }, evento.tipo === 'error' ? 5000 : 2800);
    });
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div style={{
      position: 'fixed', top: 16, left: 0, right: 0, zIndex: 1000,
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
      pointerEvents: 'none', padding: '0 16px',
    }}>
      {toasts.map(t => (
        <div key={t.id} className={`toast ${t.tipo}`}>
          <span className="toast-icono">{t.tipo === 'error' ? '✕' : '✓'}</span>
          <span>{t.mensaje}</span>
        </div>
      ))}
    </div>
  );
}
