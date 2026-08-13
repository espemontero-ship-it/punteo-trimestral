'use client';

import { useRef, useState } from 'react';
import { uploadPresigned } from '@vercel/blob/client';

export default function SubirFacturaLote({ loteId, onSubida }) {
  const inputRef = useRef(null);
  const [concepto, setConcepto] = useState('');
  const [importe, setImporte] = useState('');
  const [fecha, setFecha] = useState('');
  const [archivo, setArchivo] = useState(null);
  const [subiendo, setSubiendo] = useState(false);
  const [mensaje, setMensaje] = useState(null);

  async function onSubmit(e) {
    e.preventDefault();
    if (!archivo) { setMensaje('Choose a file first.'); return; }
    setSubiendo(true);
    setMensaje(null);
    try {
      const blob = await uploadPresigned(`lote-${loteId}-${Date.now()}-${archivo.name}`, archivo, {
        access: 'private',
        handleUploadUrl: '/api/blob-upload',
      });
      const res = await fetch(`/api/colaborador/lotes/${loteId}/facturas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rutaBlob: blob.url, nombreOriginal: archivo.name, concepto, importe, fecha }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMensaje(data.error || 'Could not upload.');
      } else {
        setMensaje(`Uploaded as invoice #${data.factura.numero}.`);
        setConcepto('');
        setImporte('');
        setFecha('');
        setArchivo(null);
        if (inputRef.current) inputRef.current.value = '';
        onSubida();
      }
    } finally {
      setSubiendo(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="tarjeta" style={{ background: 'rgba(255,255,255,0.03)' }}>
      <strong>Upload invoice</strong>
      <div style={{ height: 8 }} />
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,image/*"
        capture="environment"
        onChange={e => setArchivo(e.target.files[0])}
      />
      <div style={{ height: 8 }} />
      <input type="text" placeholder="Description (e.g. petrol, gaffer tape...)" value={concepto} onChange={e => setConcepto(e.target.value)} />
      <div style={{ height: 8 }} />
      <input type="number" step="0.01" placeholder="Amount" value={importe} onChange={e => setImporte(e.target.value)} />
      <div style={{ height: 8 }} />
      <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} />
      <div style={{ height: 8 }} />
      <button className="grande" type="submit" disabled={subiendo}>{subiendo ? 'Uploading...' : 'Upload invoice'}</button>
      {mensaje && <p className="muted" style={{ marginTop: 8 }}>{mensaje}</p>}
    </form>
  );
}
