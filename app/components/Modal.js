'use client';

export function Modal({ abierto, titulo, onCerrar, children, ancho }) {
  if (!abierto) return null;
  return (
    <div className="dialogo-fondo" onClick={onCerrar}>
      <div className="dialogo" style={ancho ? { maxWidth: ancho } : undefined} onClick={e => e.stopPropagation()}>
        <div className="fila" style={{ marginBottom: 14, alignItems: 'flex-start' }}>
          <p className="dialogo-titulo" style={{ margin: 0 }}>{titulo}</p>
          <button type="button" className="secundario" onClick={onCerrar}>Cerrar</button>
        </div>
        {children}
      </div>
    </div>
  );
}
