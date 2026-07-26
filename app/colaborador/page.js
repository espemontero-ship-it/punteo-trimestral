'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import SubirFacturaLote from '../components/SubirFacturaLote';

export default function ColaboradorPage() {
  const [nombre, setNombre] = useState('');
  const [lotes, setLotes] = useState(null);
  const [loteId, setLoteId] = useState(null);
  const [lote, setLote] = useState(null);
  const [facturas, setFacturas] = useState([]);
  const [totales, setTotales] = useState(null);
  const router = useRouter();

  const cargarLotes = useCallback(async () => {
    const r = await fetch('/api/colaborador/lotes').then(res => res.json());
    setNombre(r.nombre || '');
    setLotes(r.lotes || []);
    if ((r.lotes || []).length === 1) setLoteId(r.lotes[0].id);
  }, []);

  useEffect(() => { cargarLotes(); }, [cargarLotes]);

  const cargarLote = useCallback(async () => {
    if (!loteId) return;
    const r = await fetch(`/api/colaborador/lotes/${loteId}`).then(res => res.json());
    setLote(r.lote);
    setFacturas(r.facturas || []);
    setTotales(r.totales);
  }, [loteId]);

  useEffect(() => { cargarLote(); }, [cargarLote]);

  async function salir() {
    await fetch('/api/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  if (lotes === null) return <div className="contenedor"><p className="muted">Cargando...</p></div>;

  if (!loteId) {
    return (
      <div className="contenedor" style={{ paddingTop: '8vh' }}>
        <div className="tarjeta">
          <div className="fila">
            <h1 style={{ margin: 0 }}>Hola, {nombre}</h1>
            <button className="secundario" onClick={salir}>Salir</button>
          </div>
          {lotes.length === 0 && <p className="muted">Todavía no tienes ningún lote asignado.</p>}
          {lotes.map(l => (
            <div key={l.id} className="tarjeta fila" style={{ cursor: 'pointer', background: 'rgba(255,255,255,0.03)' }} onClick={() => setLoteId(l.id)}>
              <div>
                <strong>{l.evento}</strong>
                <div className="muted">{Number(l.total_subido).toFixed(2)}€ subidas</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="contenedor">
      <div className="fila" style={{ marginTop: 16 }}>
        <div>
          <h1 style={{ margin: 0 }}>{lote?.evento}</h1>
          <p className="muted" style={{ margin: 0 }}>Hola, {nombre}</p>
        </div>
        <div>
          {lotes.length > 1 && <button className="secundario" onClick={() => setLoteId(null)} style={{ marginRight: 8 }}>Cambiar lote</button>}
          <button className="secundario" onClick={salir}>Salir</button>
        </div>
      </div>

      {totales && (
        <div className="tarjeta">
          <div className="fila"><span>Total subido hasta ahora</span><strong>{totales.totalSubido.toFixed(2)}€</strong></div>
        </div>
      )}

      <SubirFacturaLote loteId={loteId} onSubida={cargarLote} />

      <div className="tarjeta">
        <strong>Tus facturas</strong>
        {facturas.length === 0 && <p className="muted">Todavía no has subido ninguna.</p>}
        {facturas.map(f => (
          <div key={f.id} className="tarjeta" style={{ background: 'rgba(255,255,255,0.03)' }}>
            <div className="fila">
              <div>
                <div>{f.concepto || '(sin concepto)'}</div>
                <div className="muted">{Number(f.importe_declarado || 0).toFixed(2)}€ · #{f.numero}</div>
              </div>
              {f.estado_revision && f.estado_revision !== 'subida' && (
                <span className={`etiqueta ${f.estado_revision === 'aceptada' ? 'fija' : 'nueva'}`}>{f.estado_revision}</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
