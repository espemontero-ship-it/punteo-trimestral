'use client';

import { useEffect, useRef, useState } from 'react';
import { uploadPresigned } from '@vercel/blob/client';
import { huellaDeArchivo, facturaConEseArchivo } from '../lib/huella';

// Un único formulario de subida para colaboradores. Admite VARIOS archivos a
// la vez: se suben uno detrás de otro con los mismos datos del formulario.
// El proyecto se elige siempre (ya no se asigna uno fijo al alta) -- entra
// por el lote de ese proyecto, creándolo al vuelo si hace falta (ver
// buscarOCrearLote). "Quién paga" (Yo/NOL) solo aparece si el colaborador
// tiene el permiso puede_subir_facturas_generales; si no, siempre paga él.
export default function SubirFacturaColaborador({ proyectoId, puedeSubirFacturasGenerales, onSubida }) {
  const inputRef = useRef(null);
  const [archivos, setArchivos] = useState([]);
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
    if (archivos.length === 0) { setMensaje('Choose a file first.'); return; }
    if (!proyectoSeleccionado) { setMensaje('Choose a project first.'); return; }
    setSubiendo(true);
    setMensaje(null);
    const problemas = [];
    let subidas = 0;
    try {
      for (const archivo of archivos) {
        try {
          // If this exact file is already uploaded, it is not uploaded again.
          if (await facturaConEseArchivo(await huellaDeArchivo(archivo))) {
            problemas.push(`${archivo.name}: already uploaded.`);
            continue;
          }
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
          if (!res.ok || data?.tipo === 'error') problemas.push(`${archivo.name}: ${data.error || data.detalle || 'could not upload'}`);
          else subidas++;
        } catch (err) {
          problemas.push(`${archivo.name}: ${err.message}`);
        }
      }

      setMensaje([
        subidas ? `${subidas} invoice(s) uploaded.` : null,
        ...problemas,
      ].filter(Boolean).join(' '));
      if (subidas > 0) {
        setConcepto(''); setImporte(''); setFecha(''); setArchivos([]);
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
        multiple
        onChange={e => setArchivos([...e.target.files])}
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
      <button className="grande" type="submit" disabled={subiendo}>{subiendo ? 'Uploading...' : (archivos.length > 1 ? `Upload ${archivos.length} invoices` : 'Upload invoice')}</button>
      {mensaje && <p className="muted" style={{ marginTop: 8 }}>{mensaje}</p>}
    </form>
  );
}
