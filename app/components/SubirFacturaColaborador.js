'use client';

import { useEffect, useRef, useState } from 'react';
import { uploadPresigned } from '@vercel/blob/client';

// Un único formulario de subida para colaboradores, un archivo cada vez.
// El proyecto se elige siempre (ya no se asigna uno fijo al alta) -- entra
// por el lote de ese proyecto, creándolo al vuelo si hace falta (ver
// buscarOCrearLote). "Quién paga" (Yo/NOL) solo aparece si el colaborador
// tiene el permiso puede_subir_facturas_generales; si no, siempre paga él.
export default function SubirFacturaColaborador({ proyectoId, puedeSubirFacturasGenerales, onSubida }) {
  const inputRef = useRef(null);
  const [archivo, setArchivo] = useState(null);
  const [concepto, setConcepto] = useState('');
  const [importe, setImporte] = useState('');
  const [fecha, setFecha] = useState('');
  const [quienPaga, setQuienPaga] = useState('colaborador');
  const [proyectoSeleccionado, setProyectoSeleccionado] = useState(proyectoId || '');
  const [proyectos, setProyectos] = useState([]);
  const [subiendo, setSubiendo] = useState(false);
  const [mensaje, setMensaje] = useState(null);

  useEffect(() => {
    fetch('/api/colaborador/proyectos').then(r => r.json()).then(d => setProyectos(d.proyectos || []));
  }, []);

  useEffect(() => { setProyectoSeleccionado(proyectoId || ''); }, [proyectoId]);

  async function onSubmit(e) {
    e.preventDefault();
    if (!archivo) { setMensaje('Choose a file first.'); return; }
    if (!proyectoSeleccionado) { setMensaje('Choose a project first.'); return; }
    setSubiendo(true);
    setMensaje(null);
    try {
      const blob = await uploadPresigned(`facturas/colaborador-${Date.now()}-${archivo.name}`, archivo, {
        access: 'private',
        handleUploadUrl: '/api/blob-upload',
      });
      const res = await fetch('/api/colaborador/facturas-generales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rutaBlob: blob.url, nombreOriginal: archivo.name, concepto, importe, fecha,
          proyectoId: proyectoSeleccionado, quienPaga: puedeSubirFacturasGenerales ? quienPaga : 'colaborador',
        }),
      });
      const data = await res.json();
      if (!res.ok || data?.tipo === 'error') {
        setMensaje(data.error || data.detalle || 'Could not upload.');
      } else {
        setMensaje('Uploaded.');
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
      <select value={proyectoSeleccionado} onChange={e => setProyectoSeleccionado(e.target.value)}>
        <option value="">Choose project...</option>
        {proyectos.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
      </select>

      {puedeSubirFacturasGenerales && (
        <>
          <div style={{ height: 8 }} />
          <select value={quienPaga} onChange={e => setQuienPaga(e.target.value)}>
            <option value="colaborador">I pay</option>
            <option value="nol">NOL pays</option>
          </select>
        </>
      )}

      <div style={{ height: 8 }} />
      <button className="grande" type="submit" disabled={subiendo}>{subiendo ? 'Uploading...' : 'Upload invoice'}</button>
      {mensaje && <p className="muted" style={{ marginTop: 8 }}>{mensaje}</p>}
    </form>
  );
}
