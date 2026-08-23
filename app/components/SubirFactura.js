'use client';

import { useRef, useState } from 'react';
import { uploadPresigned } from '@vercel/blob/client';
import { huellaDeArchivo, facturaConEseArchivo } from '../lib/huella';

export default function SubirFactura({ hoja, clave, etiqueta, onResultado, className = 'secundario', conIcono = true }) {
  const inputRef = useRef(null);
  const [archivos, setArchivos] = useState([]);
  const [concepto, setConcepto] = useState('');
  const [importe, setImporte] = useState('');
  const [fecha, setFecha] = useState('');
  const [subiendo, setSubiendo] = useState(false);

  function onFileChange(e) {
    const elegidos = [...e.target.files];
    e.target.value = '';
    if (elegidos.length) setArchivos(elegidos);
  }

  // Se pueden elegir varias a la vez: se suben una detras de otra con los
  // mismos datos del formulario, y cada una devuelve su resultado.
  async function subir() {
    if (archivos.length === 0) return;
    setSubiendo(true);
    try {
      for (const archivo of archivos) {
        try {
          // Antes de subir nada: si este archivo ya está guardado, no se sube.
          // La huella se calcula aquí mismo, en el navegador, y no cuesta nada.
          const ya = await facturaConEseArchivo(await huellaDeArchivo(archivo));
          if (ya) {
            onResultado({ tipo: 'duplicada', detalle: `${archivo.name}: ese archivo ya está subido como factura #${ya.numero} (${ya.nombre}). No se ha subido.` });
            continue;
          }

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
          onResultado(await res.json());
        } catch (err) {
          onResultado({ tipo: 'error', detalle: `${archivo.name}: ${err.message}` });
        }
      }
      setArchivos([]);
      setConcepto('');
      setImporte('');
      setFecha('');
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
        multiple
        onChange={onFileChange}
        style={{ display: 'none' }}
      />
      {archivos.length === 0 ? (
        <button type="button" className={className} onClick={() => inputRef.current?.click()}>
          {conIcono && '📎 '}{etiqueta || 'Subir factura'}
        </button>
      ) : (
        <div className="form-factura-suelta">
          <p className="muted" style={{ margin: '0 0 8px' }}>
            {archivos.length === 1 ? archivos[0].name : `${archivos.length} archivos`}
          </p>
          <input type="text" placeholder="Concepto (ej. gasolina, cinta americana...)" value={concepto} onChange={e => setConcepto(e.target.value)} />
          <div style={{ height: 8 }} />
          <input type="number" step="0.01" placeholder="Importe (si lo sabes)" value={importe} onChange={e => setImporte(e.target.value)} />
          <div style={{ height: 8 }} />
          <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} />
          <div style={{ height: 8 }} />
          <div className="fila" style={{ gap: 8 }}>
            <button type="button" className="grande" disabled={subiendo} onClick={subir}>{subiendo ? 'Subiendo...' : (archivos.length > 1 ? `Subir ${archivos.length}` : 'Subir')}</button>
            <button type="button" className="secundario" disabled={subiendo} onClick={() => setArchivos([])}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
  );
}
