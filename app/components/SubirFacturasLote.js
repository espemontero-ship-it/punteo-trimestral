'use client';

import { useRef, useState } from 'react';
import { uploadPresigned } from '@vercel/blob/client';
import { huellaDeArchivo, facturaConEseArchivo } from '../lib/huella';

// Sube varios archivos de golpe, uno a uno (misma lógica de siempre por
// archivo, sin cambios de backend), y al terminar entrega la lista completa
// de resultados para que la pantalla que la use decida qué mostrar.
export default function SubirFacturasLote({ onCompletado, endpoint = '/api/facturas' }) {
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
        // Si ese archivo ya está guardado, ese no se sube y se sigue con
        // el siguiente. La huella se calcula aquí, gratis.
        const ya = await facturaConEseArchivo(await huellaDeArchivo(file));
        if (ya) {
          resultados.push({ nombreArchivo: file.name, resultado: {
            tipo: 'duplicada',
            detalle: `Ese archivo ya está subido como factura #${ya.numero} (${ya.nombre}). No se ha subido.`,
          } });
          continue;
        }

        const blob = await uploadPresigned(`facturas/lote-${Date.now()}-${file.name}`, file, {
          access: 'private',
          handleUploadUrl: '/api/blob-upload',
        });
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rutaBlob: blob.url, nombreOriginal: file.name }),
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
    <>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,image/*"
        multiple
        onChange={onFilesChange}
        style={{ display: 'none' }}
      />
      {progreso ? (
        <div className="zona-subida-lote-progreso">
          <div className="fila-progreso-lote">
            <span className="num-progreso-lote">Subiendo {progreso.actual} de {progreso.total}</span>
            <span className="muted">{progreso.nombre}</span>
          </div>
          <div className="progreso"><div style={{ width: `${(progreso.actual / progreso.total) * 100}%` }} /></div>
        </div>
      ) : (
        <button type="button" className="secundario" onClick={() => inputRef.current?.click()}>📎 Subir facturas</button>
      )}
    </>
  );
}
