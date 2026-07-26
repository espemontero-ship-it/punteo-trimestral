'use client';

import { useRef, useState } from 'react';
import { upload } from '@vercel/blob/client';

export default function SubirFactura({ trimestreId, hoja, clave, onResultado }) {
  const inputRef = useRef(null);
  const [subiendo, setSubiendo] = useState(false);

  async function onFileChange(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;

    setSubiendo(true);
    try {
      const blob = await upload(`${trimestreId}/${hoja}-${clave}-${Date.now()}-${file.name}`, file, {
        access: 'public',
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
        className="secundario"
        disabled={subiendo}
        onClick={() => inputRef.current?.click()}
      >
        {subiendo ? 'Subiendo...' : '📎 Subir factura'}
      </button>
    </div>
  );
}
