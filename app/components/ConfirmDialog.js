'use client';

import { useState } from 'react';

// Diálogo de confirmación simple, sustituye a window.confirm().
export function ConfirmDialog({ abierto, titulo, mensaje, textoConfirmar = 'Confirmar', peligroso, onConfirmar, onCancelar }) {
  if (!abierto) return null;
  return (
    <Overlay onCancelar={onCancelar}>
      <p className="dialogo-titulo">{titulo}</p>
      {mensaje && <p className="dialogo-cuerpo">{mensaje}</p>}
      <div className="dialogo-botones">
        <button className="secundario" onClick={onCancelar} style={{ flex: 1 }}>Cancelar</button>
        <button
          onClick={onConfirmar}
          style={{ flex: 1, background: peligroso ? '#c2493a' : undefined, color: peligroso ? '#fff' : undefined }}
        >
          {textoConfirmar}
        </button>
      </div>
    </Overlay>
  );
}

// Diálogo para elegir un motivo de una lista (con opción "otro" en texto libre),
// sustituye a window.prompt().
export function MotivoDialog({ abierto, titulo, opciones, onConfirmar, onCancelar }) {
  const [elegido, setElegido] = useState(opciones?.[0] || '');
  const [otro, setOtro] = useState('');

  if (!abierto) return null;
  const esOtro = elegido === '__otro__';

  return (
    <Overlay onCancelar={onCancelar}>
      <p className="dialogo-titulo">{titulo}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '14px 0 18px' }}>
        {opciones.map(op => (
          <label key={op} className={`radio-fila ${elegido === op ? 'selected' : ''}`}>
            <input type="radio" name="motivo" checked={elegido === op} onChange={() => setElegido(op)} style={{ display: 'none' }} />
            <span className="radio-punto" />
            {op}
          </label>
        ))}
        <label className={`radio-fila ${esOtro ? 'selected' : ''}`}>
          <input type="radio" name="motivo" checked={esOtro} onChange={() => setElegido('__otro__')} style={{ display: 'none' }} />
          <span className="radio-punto" />
          Otro motivo
        </label>
        {esOtro && (
          <input type="text" placeholder="Escribe el motivo" value={otro} onChange={e => setOtro(e.target.value)} autoFocus />
        )}
      </div>
      <div className="dialogo-botones">
        <button className="secundario" onClick={onCancelar} style={{ flex: 1 }}>Cancelar</button>
        <button
          style={{ flex: 1 }}
          disabled={esOtro && !otro.trim()}
          onClick={() => onConfirmar(esOtro ? otro.trim() : elegido)}
        >
          Confirmar
        </button>
      </div>
    </Overlay>
  );
}

function Overlay({ children, onCancelar }) {
  return (
    <div className="dialogo-fondo" onClick={onCancelar}>
      <div className="dialogo" onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
