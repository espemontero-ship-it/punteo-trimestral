'use client';

import { useRef, useState } from 'react';
import { uploadPresigned } from '@vercel/blob/client';

// Sube varios archivos de golpe, uno a uno (misma lógica de siempre por
// archivo, sin cambios de backend), y al terminar entrega la lista completa
// de resultados para que la pantalla que la use decida qué mostrar.
export default function SubirFacturasLote({ trimestreId, onCompletado }) {
  const inputRef = useRef(null);
  const [progreso, setProgreso] = useState(null); // { actual, total, nombre } | null

  async function onFilesChange(e) {
    const files = [...e.target.files];
    e.target.value = '';
    if (files.length === 0) return;

    const resultados = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setProgreso({ actual: i + 1, total: files.length, nombre: file.name });
      try {
        const blob = await uploadPresigned(`${trimestreId}/lote-${Date.now()}-${file.name}`, file, {
          access: 'private',
          handleUploadUrl: '/api/blob-upload',
        });
        const res = await fetch('/api/facturas', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ trimestreId, rutaBlob: blob.url, nombreOriginal: file.name }),
        });
        const resultado = await res.json();
        resultados.push({ nombreArchivo: file.name, resultado });
      } catch (err) {
        resultados.push({ nombreArchivo: file.name, resultado: { tipo: 'error', detalle: err.message } });
      }
    }

    setProgreso(null);
    onCompletado(resultados);
  }

  return (
    <div className="zona-subida-lote">
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,image/*"
        multiple
        onChange={onFilesChange}
        style={{ display: 'none' }}
      />
      {progreso ? (
        <div>
          <div className="fila-progreso-lote">
            <span className="num-progreso-lote">Subiendo {progreso.actual} de {progreso.total}</span>
            <span className="muted">{progreso.nombre}</span>
          </div>
          <div className="progreso"><div style={{ width: `${(progreso.actual / progreso.total) * 100}%` }} /></div>
        </div>
      ) : (
        <>
          <p className="muted" style={{ margin: '0 0 12px' }}>
            Selecciona varios PDFs o fotos a la vez — se emparejan solas contra los movimientos pendientes.
          </p>
          <button className="grande" onClick={() => inputRef.current?.click()}>📎 Subir facturas</button>
        </>
      )}
    </div>
  );
}
