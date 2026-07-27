'use client';

import { useEffect, useState, useCallback } from 'react';
import GrupoProveedor from './components/GrupoProveedor';
import SubirFactura from './components/SubirFactura';
import SelectorTrimestre from './components/SelectorTrimestre';
import SeccionLotes from './components/SeccionLotes';
import { apiFetch } from './lib/toast';

export default function Home() {
  const [trimestreId, setTrimestreId] = useState('');
  const [proveedores, setProveedores] = useState(null);
  const [resumen, setResumen] = useState(null);
  const [facturas, setFacturas] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [subiendoExcel, setSubiendoExcel] = useState(false);
  const [mensajeExcel, setMensajeExcel] = useState(null);
  const [mensajeFacturaSuelta, setMensajeFacturaSuelta] = useState(null);

  useEffect(() => {
    const guardado = localStorage.getItem('trimestreId');
    if (guardado) setTrimestreId(guardado);
  }, []);

  const cargar = useCallback(async id => {
    if (!id) return;
    setCargando(true);
    try {
      const [rp, rr, rf] = await Promise.all([
        apiFetch(`/api/trimestres/${id}/proveedores`, undefined, { mensajeError: 'No se pudieron cargar los proveedores.' }),
        apiFetch(`/api/trimestres/${id}/resumen`, undefined, { mensajeError: 'No se pudo cargar el resumen.' }),
        apiFetch(`/api/trimestres/${id}/facturas`, undefined, { mensajeError: 'No se pudieron cargar las facturas.' }),
      ]);
      setProveedores((rp && rp.proveedores) || []);
      setResumen(rr);
      setFacturas((rf && rf.facturas) || []);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    if (trimestreId) cargar(trimestreId);
  }, [trimestreId, cargar]);

  function entrarTrimestre(id) {
    localStorage.setItem('trimestreId', id);
    setTrimestreId(id);
  }

  async function subirExcel(e) {
    e.preventDefault();
    const file = e.target.elements.file.files[0];
    if (!file) return;
    setSubiendoExcel(true);
    setMensajeExcel(null);
    try {
      const hoja = e.target.elements.hoja.value;
      const formData = new FormData();
      formData.append('file', file);
      if (hoja) formData.append('hoja', hoja);
      const data = await apiFetch(`/api/trimestres/${trimestreId}/excels`, { method: 'POST', body: formData }, {
        mensajeError: 'No se pudo importar el excel.',
      });
      if (data) {
        setMensajeExcel(`Importado: ${data.hojas.join(', ')}`);
        await cargar(trimestreId);
      }
    } finally {
      setSubiendoExcel(false);
      e.target.reset();
    }
  }

  if (!trimestreId) {
    return <SelectorTrimestre onEntrar={entrarTrimestre} />;
  }

  const total = resumen?.total ?? 0;
  const resueltas = resumen?.resueltas ?? 0;
  const porcentaje = total ? Math.round((resueltas / total) * 100) : 0;

  return (
    <div className="contenedor">
      <div className="fila" style={{ marginTop: 16 }}>
        <h1 style={{ margin: 0 }}>{trimestreId}</h1>
        <div>
          <button className="secundario" onClick={() => { localStorage.removeItem('trimestreId'); setTrimestreId(''); setProveedores(null); }} style={{ marginRight: 8 }}>
            Cambiar trimestre
          </button>
          <button className="secundario" onClick={async () => { await fetch('/api/logout', { method: 'POST' }); window.location.href = '/login'; }}>
            Salir
          </button>
        </div>
      </div>

      <div className="tarjeta">
        <div className="muted">{resueltas} de {total} líneas resueltas</div>
        <div className="progreso"><div style={{ width: `${porcentaje}%` }} /></div>
        <a href={`/api/trimestres/${trimestreId}/cerrar`}>
          <button className="grande">Cerrar trimestre (descargar .zip)</button>
        </a>
      </div>

      <div className="tarjeta">
        <strong>Añadir excel del banco / paypal</strong>
        <p className="muted">Si es el excel combinado (bbva/openbank/paypal en pestañas), déjalo en "Detectar automáticamente". Si es un export suelto de un solo banco, indícalo.</p>
        <form onSubmit={subirExcel} style={{ marginTop: 8 }}>
          <input type="file" name="file" accept=".xlsx" />
          <div style={{ height: 12 }} />
          <select name="hoja" defaultValue="">
            <option value="">Detectar automáticamente (excel combinado)</option>
            <option value="bbva">Es un export suelto de bbva</option>
            <option value="openbank">Es un export suelto de openbank</option>
            <option value="paypal">Es un export suelto de paypal</option>
          </select>
          <div style={{ height: 12 }} />
          <button type="submit" disabled={subiendoExcel}>{subiendoExcel ? 'Subiendo...' : 'Subir'}</button>
        </form>
        {mensajeExcel && <p className="muted">{mensajeExcel}</p>}
      </div>

      <div className="tarjeta">
        <strong>Subir factura suelta</strong>
        <p className="muted">
          Para cuando consigues una factura antes de tener el excel del banco (ej. una foto en el momento de comprar).
          Se guarda y se intenta emparejar en cuanto subas o actualices el excel.
        </p>
        <SubirFactura
          trimestreId={trimestreId}
          etiqueta="Subir factura suelta"
          onResultado={r => setMensajeFacturaSuelta(r.detalle)}
        />
        {mensajeFacturaSuelta && <p className="muted" style={{ marginTop: 8 }}>{mensajeFacturaSuelta}</p>}
        {facturas && (() => {
          const sueltas = facturas.filter(f => !f.proveedor_clave);
          const pendientes = facturas.filter(f => f.estado !== 'matcheada');
          if (facturas.length === 0) return null;
          return (
            <p className="muted" style={{ marginTop: 8 }}>
              {facturas.length} factura(s) subida(s) — {pendientes.length} sin resolver todavía
              {sueltas.length > 0 ? ` (${sueltas.length} sin proveedor asignado aún)` : ''}.
            </p>
          );
        })()}
      </div>

      <SeccionLotes trimestreId={trimestreId} />

      {cargando && <p className="muted">Cargando...</p>}

      {proveedores && proveedores.length === 0 && (
        <p className="muted">Todavía no hay movimientos. Sube el excel del trimestre para empezar.</p>
      )}

      {proveedores && proveedores.map(g => (
        <GrupoProveedor key={g.id} trimestreId={trimestreId} grupo={g} onCambio={() => cargar(trimestreId)} />
      ))}
    </div>
  );
}
