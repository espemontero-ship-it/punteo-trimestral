'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import SubirFacturaLote from '../components/SubirFacturaLote';
import SubirFacturasNol from '../components/SubirFacturasNol';
import TablaCuentas from '../components/TablaCuentas';

export default function ColaboradorPage() {
  const [nombre, setNombre] = useState('');
  const [lotes, setLotes] = useState(null);
  const [loteId, setLoteId] = useState(null);
  const [lote, setLote] = useState(null);
  const [facturas, setFacturas] = useState([]);
  const [pagos, setPagos] = useState([]);
  const [totales, setTotales] = useState(null);
  const [puedeInvitar, setPuedeInvitar] = useState(false);
  const [puedeSubirFacturasGenerales, setPuedeSubirFacturasGenerales] = useState(false);
  const router = useRouter();

  const cargarLotes = useCallback(async () => {
    const r = await fetch('/api/colaborador/lotes').then(res => res.json());
    setNombre(r.nombre || '');
    setLotes(r.lotes || []);
    setPuedeInvitar(!!r.puedeInvitar);
    setPuedeSubirFacturasGenerales(!!r.puedeSubirFacturasGenerales);
    if ((r.lotes || []).length === 1) setLoteId(r.lotes[0].id);
  }, []);

  useEffect(() => { cargarLotes(); }, [cargarLotes]);

  const cargarLote = useCallback(async () => {
    if (!loteId) return;
    const r = await fetch(`/api/colaborador/lotes/${loteId}`).then(res => res.json());
    setLote(r.lote);
    setFacturas(r.facturas || []);
    setPagos(r.pagos || []);
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
          {lotes.length === 0 && !puedeSubirFacturasGenerales && <p className="muted">Todavía no tienes ningún lote asignado.</p>}
          {lotes.map(l => (
            <div key={l.id} className="tarjeta fila" style={{ cursor: 'pointer', background: 'rgba(255,255,255,0.03)' }} onClick={() => setLoteId(l.id)}>
              <div>
                <strong>{l.evento}</strong>
                <div className="muted">{Number(l.total_subido).toFixed(2)}€ subidas</div>
              </div>
            </div>
          ))}
        </div>
        {puedeSubirFacturasGenerales && <SubirFacturasGenerales />}
      </div>
    );
  }

  return (
    <div className="contenedor contenedor-ancho">
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

      <div className="tarjeta">
        <strong>Datos para pedir la factura</strong>
        <p className="muted" style={{ marginTop: 6, marginBottom: 0 }}>
          NotOnlyLarp<br />
          G87705794<br />
          Josué Lillo 10, 1º B<br />
          28053 Madrid
        </p>
        <p className="muted" style={{ marginTop: 10, marginBottom: 0 }}>
          Sin factura a estos datos no podemos hacer el pago, por razones legales.
        </p>
      </div>

      <SubirFacturaLote loteId={loteId} onSubida={cargarLote} />

      {puedeInvitar && <InvitarColaborador proyectoNombre={lote?.evento} proyectoId={lote?.proyecto_id} />}
      {puedeSubirFacturasGenerales && <SubirFacturasGenerales proyectoIdPorDefecto={lote?.proyecto_id} />}

      <TablaCuentas lote={lote} facturas={facturas} pagos={pagos} totales={totales} soloLectura />
    </div>
  );
}

function SubirFacturasGenerales({ proyectoIdPorDefecto }) {
  return (
    <div className="tarjeta">
      <strong>Subir facturas de NOL</strong>
      <p className="muted" style={{ marginTop: 6 }}>Elige quién paga y el proyecto una vez; cada archivo lleva su propia fecha, concepto e importe.</p>
      <div style={{ marginTop: 8 }}>
        <SubirFacturasNol proyectoIdPorDefecto={proyectoIdPorDefecto} />
      </div>
    </div>
  );
}

function InvitarColaborador({ proyectoNombre, proyectoId }) {
  const [nombre, setNombre] = useState('');
  const [usuario, setUsuario] = useState('');
  const [resultado, setResultado] = useState(null);
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    if (!nombre || !usuario || !proyectoId) return;
    setEnviando(true);
    setError(null);
    try {
      const res = await fetch('/api/colaborador/invitaciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre, usuario, proyectoId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'No se pudo invitar.');
        return;
      }
      setResultado(data.enlace);
      setNombre('');
      setUsuario('');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="tarjeta">
      <strong>Invitar a alguien a {proyectoNombre}</strong>
      <p className="muted" style={{ marginTop: 6 }}>Le llega un correo para que elija su propia contraseña.</p>
      <form onSubmit={onSubmit}>
        <input type="text" placeholder="Nombre" value={nombre} onChange={e => setNombre(e.target.value)} />
        <div style={{ height: 8 }} />
        <input type="text" placeholder="Correo" value={usuario} onChange={e => setUsuario(e.target.value)} />
        <div style={{ height: 8 }} />
        <button type="submit" className="secundario" disabled={enviando}>{enviando ? 'Invitando...' : 'Invitar'}</button>
        {error && <p className="error">{error}</p>}
      </form>
      {resultado && (
        <p className="muted" style={{ marginTop: 8 }}>
          Invitación enviada. Si el correo aún no está configurado, este es el enlace: <a href={resultado}>{resultado}</a>
        </p>
      )}
    </div>
  );
}
