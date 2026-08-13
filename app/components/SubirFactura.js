'use client';

import { useRef, useState } from 'react';
import { uploadPresigned } from '@vercel/blob/client';

export default function SubirFactura({ hoja, clave, etiqueta, onResultado, className = 'secundario', conIcono = true }) {
  const inputRef = useRef(null);
  const [archivo, setArchivo] = useState(null);
  const [concepto, setConcepto] = useState('');
  const [importe, setImporte] = useState('');
  const [fecha, setFecha] = useState('');
  const [subiendo, setSubiendo] = useState(false);

  function onFileChange(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) setArchivo(file);
  }

  async function subir() {
    if (!archivo) return;
    setSubiendo(true);
    try {
      const prefijo = hoja && clave ? `${hoja}-${clave}` : 'sueltas';
      const blob = await uploadPresigned(`facturas/${prefijo}-${Date.now()}-${archivo.name}`, archivo, {
        access: 'private',
        handleUploadUrl: '/api/blob-upload',
      });

      const res = await fetch('/api/facturas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hoja, clave, rutaBlob: blob.url, nombreOriginal: archivo.name, concepto, importe, fecha }),
      });
      const resultado = await res.json();
      onResultado(resultado);
      setArchivo(null);
      setConcepto('');
      setImporte('');
      setFecha('');
    } catch (err) {
      onResultado({ tipo: 'error', detalle: err.message });
    } finally {
      setSubiendo(false);
    }
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,image/*"
        capture="environment"
        onChange={onFileChange}
        style={{ display: 'none' }}
      />
      {!archivo ? (
        <button type="button" className={className} onClick={() => inputRef.current?.click()}>
          {conIcono && '📎 '}{etiqueta || 'Subir factura'}
        </button>
      ) : (
        <div className="form-factura-suelta">
          <p className="muted" style={{ margin: '0 0 8px' }}>{archivo.name}</p>
          <input type="text" placeholder="Concepto (ej. gasolina, cinta americana...)" value={concepto} onChange={e => setConcepto(e.target.value)} />
          <div style={{ height: 8 }} />
          <input type="number" step="0.01" placeholder="Importe (si lo sabes)" value={importe} onChange={e => setImporte(e.target.value)} />
          <div style={{ height: 8 }} />
          <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} />
          <div style={{ height: 8 }} />
          <div className="fila" style={{ gap: 8 }}>
            <button type="button" className="grande" disabled={subiendo} onClick={subir}>{subiendo ? 'Subiendo...' : 'Subir'}</button>
            <button type="button" className="secundario" disabled={subiendo} onClick={() => setArchivo(null)}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
  );
}
