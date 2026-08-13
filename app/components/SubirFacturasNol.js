'use client';

import { useEffect, useRef, useState } from 'react';
import { uploadPresigned } from '@vercel/blob/client';

// Facturas pagadas por NOL o por el propio colaborador, siempre ligadas a un
// proyecto -- "Quién paga" y "Proyecto" se eligen una vez para toda la tanda
// de archivos; Fecha/Concepto/Importe son propios de cada archivo. Si paga el
// colaborador, la factura entra por el flujo normal de su lote de ese
// proyecto (se crea el lote si hace falta); si paga NOL, sigue el motor de
// facturas generales con el proyecto ya indicado.
export default function SubirFacturasNol({ proyectoIdPorDefecto } = {}) {
  const inputRef = useRef(null);
  const [proyectos, setProyectos] = useState([]);
  const [quienPaga, setQuienPaga] = useState('nol');
  const [proyectoId, setProyectoId] = useState(proyectoIdPorDefecto || '');
  const [archivos, setArchivos] = useState([]); // { file, concepto, importe, fecha }
  const [subiendo, setSubiendo] = useState(false);
  const [progreso, setProgreso] = useState(null); // { actual, total }
  const [resumen, setResumen] = useState(null);

  useEffect(() => {
    fetch('/api/proyectos').then(r => r.json()).then(d => setProyectos(d.proyectos || []));
  }, []);

  function onFilesChange(e) {
    const files = [...e.target.files];
    e.target.value = '';
    if (files.length === 0) return;
    setArchivos(prev => [...prev, ...files.map(file => ({ file, concepto: '', importe: '', fecha: '' }))]);
    setResumen(null);
  }

  function actualizarArchivo(i, campo, valor) {
    setArchivos(prev => prev.map((a, idx) => idx === i ? { ...a, [campo]: valor } : a));
  }

  function quitarArchivo(i) {
    setArchivos(prev => prev.filter((_, idx) => idx !== i));
  }

  async function subirTodas() {
    if (!proyectoId || archivos.length === 0) return;
    setSubiendo(true);
    let ok = 0, errores = 0;
    for (let i = 0; i < archivos.length; i++) {
      setProgreso({ actual: i + 1, total: archivos.length });
      const a = archivos[i];
      try {
        const blob = await uploadPresigned(`facturas/nol-${Date.now()}-${a.file.name}`, a.file, {
          access: 'private',
          handleUploadUrl: '/api/blob-upload',
        });
        const res = await fetch('/api/colaborador/facturas-generales', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rutaBlob: blob.url, nombreOriginal: a.file.name,
            concepto: a.concepto, importe: a.importe, fecha: a.fecha,
            proyectoId, quienPaga,
          }),
        });
        const data = await res.json();
        if (data?.tipo === 'error') errores++; else ok++;
      } catch {
        errores++;
      }
    }
    setProgreso(null);
    setSubiendo(false);
    setArchivos([]);
    setResumen({ ok, errores });
  }

  return (
    <div>
      <div className="fila" style={{ gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <select value={quienPaga} onChange={e => setQuienPaga(e.target.value)} style={{ width: 'auto' }}>
          <option value="nol">NOL pays</option>
          <option value="colaborador">I pay</option>
        </select>
        <select value={proyectoId} onChange={e => setProyectoId(e.target.value)} style={{ width: 'auto' }}>
          <option value="">Choose project...</option>
          {proyectos.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,image/*"
        multiple
        onChange={onFilesChange}
        style={{ display: 'none' }}
      />

      {archivos.map((a, i) => (
        <div key={i} className="form-factura-suelta" style={{ marginBottom: 8 }}>
          <p className="muted" style={{ margin: '0 0 8px' }}>{a.file.name}</p>
          <input type="text" placeholder="Description" value={a.concepto} onChange={e => actualizarArchivo(i, 'concepto', e.target.value)} />
          <div style={{ height: 8 }} />
          <input type="number" step="0.01" placeholder="Amount" value={a.importe} onChange={e => actualizarArchivo(i, 'importe', e.target.value)} />
          <div style={{ height: 8 }} />
          <input type="date" value={a.fecha} onChange={e => actualizarArchivo(i, 'fecha', e.target.value)} />
          <div style={{ height: 8 }} />
          <button type="button" className="secundario" onClick={() => quitarArchivo(i)}>Remove</button>
        </div>
      ))}

      <div className="fila" style={{ gap: 8 }}>
        <button type="button" className="secundario" onClick={() => inputRef.current?.click()}>📎 Add files</button>
        {archivos.length > 0 && (
          <button type="button" disabled={!proyectoId || subiendo} onClick={subirTodas}>
            {subiendo ? `Uploading ${progreso?.actual}/${progreso?.total}...` : `Upload ${archivos.length} invoice(s)`}
          </button>
        )}
      </div>

      {resumen && (
        <p className="muted" style={{ marginTop: 8 }}>
          {resumen.ok} invoice(s) uploaded{resumen.errores > 0 ? `, ${resumen.errores} with error` : ''}.
        </p>
      )}
    </div>
  );
}
