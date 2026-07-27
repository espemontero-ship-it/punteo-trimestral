'use client';

import { useRef, useState } from 'react';
import { uploadPresigned } from '@vercel/blob/client';

export default function SubirFactura({ trimestreId, hoja, clave, etiqueta, onResultado, className = 'secundario' }) {
  const inputRef = useRef(null);
  const [subiendo, setSubiendo] = useState(false);

  async function onFileChange(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;

    setSubiendo(true);
    try {
      const prefijo = hoja && clave ? `${hoja}-${clave}` : 'sueltas';
      const blob = await uploadPresigned(`${trimestreId}/${prefijo}-${Date.now()}-${file.name}`, file, {
        access: 'private',
        handleUploadUrl: '/api/blob-upload',
      });

      const res = await fetch('/api/facturas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trimestreId, hoja, clave, rutaBlob: blob.url, nombreOriginal: file.name }),
      });
      const resultado = await res.json();
      onResultado(resultado);
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
      <button
        type="button"
        className={className}
        disabled={subiendo}
        onClick={() => inputRef.current?.click()}
      >
        {subiendo ? 'Subiendo...' : `📎 ${etiqueta || 'Subir factura'}`}
      </button>
    </div>
  );
}
