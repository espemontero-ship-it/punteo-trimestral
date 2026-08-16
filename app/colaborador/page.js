'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import SubirFacturaColaborador from '../components/SubirFacturaColaborador';
import TablaCuentas from '../components/TablaCuentas';
import Ayuda from '../components/Ayuda';

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
  // Esta pantalla no tiene barra de pestañas, así que la ayuda se abre y se
  // cierra desde la cabecera y ocupa el sitio del contenido, igual que haría
  // una pestaña. Solo se le enseña la parte de colaboradores, en inglés.
  const [ayudaAbierta, setAyudaAbierta] = useState(false);
  const router = useRouter();

  const cargarLotes = useCallback(async () => {
    const r = await fetch('/api/colaborador/lotes').then(res => res.json());
    setNombre(r.nombre || '');
    setLotes(r.lotes || []);
    setPuedeInvitar(!!r.puedeInvitar);
    setPuedeSubirFacturasGenerales(!!r.puedeSubirFacturasGenerales);
    return r.lotes || [];
  }, []);

  useEffect(() => { cargarLotes(); }, [cargarLotes]);

  // Al entrar, si ya tiene exactamente un proyecto, se abre solo; con varios
  // o ninguno, elige ella qué ver (o sube directo sin elegir ninguno).
  useEffect(() => {
    if (lotes && lotes.length === 1 && loteId === null) setLoteId(lotes[0].id);
  }, [lotes, loteId]);

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

  async function onSubida() {
    await cargarLotes();
    await cargarLote();
  }

  if (lotes === null) return <div className="contenedor"><p className="muted">Loading...</p></div>;

  return (
    <div className={loteId ? 'contenedor contenedor-ancho' : 'contenedor'} style={loteId ? undefined : { paddingTop: '8vh' }}>
      <div className="fila" style={{ marginTop: loteId ? 16 : 0, marginBottom: loteId ? 0 : 16 }}>
        <div>
          <h1 style={{ margin: 0 }}>{ayudaAbierta ? 'Help' : (lote?.evento || `Hi, ${nombre}`)}</h1>
          {!ayudaAbierta && lote?.evento && <p className="muted" style={{ margin: 0 }}>Hi, {nombre}</p>}
        </div>
        <div>
          {ayudaAbierta ? (
            <button className="secundario" onClick={() => setAyudaAbierta(false)}>Back</button>
          ) : (
            <>
              <button className="secundario" onClick={() => setAyudaAbierta(true)} style={{ marginRight: 8 }}>Help</button>
              {loteId && <button className="secundario" onClick={() => setLoteId(null)} style={{ marginRight: 8 }}>Switch project</button>}
              <button className="secundario" onClick={salir}>Log out</button>
            </>
          )}
        </div>
      </div>

      {ayudaAbierta && <Ayuda soloColaboradores />}
      {!ayudaAbierta && (
      <>

      <div className="tarjeta">
        <strong>Details for the invoice</strong>
        <p className="muted" style={{ marginTop: 6, marginBottom: 0 }}>
          NotOnlyLarp<br />
          G87705794<br />
          Josué Lillo 10, 1º B<br />
          28053 Madrid, Spain
        </p>
        <p className="muted" style={{ marginTop: 10, marginBottom: 0 }}>
          Without an invoice made out to these details we can't make the payment, for legal reasons.
        </p>
      </div>

      <SubirFacturaColaborador
        proyectoId={lote?.proyecto_id}
        puedeSubirFacturasGenerales={puedeSubirFacturasGenerales}
        onSubida={onSubida}
      />

      {lotes.length > 0 && (
        <div className="tarjeta">
          <strong>Your projects</strong>
          {lotes.map(l => (
            <div key={l.id} className="tarjeta fila" style={{ cursor: 'pointer', background: 'rgba(255,255,255,0.03)', marginTop: 8, marginBottom: 0 }} onClick={() => setLoteId(l.id)}>
              <div>
                <strong>{l.evento}</strong>
                <div className="muted">{Number(l.total_subido).toFixed(2)}€ uploaded</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {puedeInvitar && loteId && <InvitarColaborador proyectoNombre={lote?.evento} proyectoId={lote?.proyecto_id} />}

      {loteId && <TablaCuentas lote={lote} facturas={facturas} pagos={pagos} totales={totales} soloLectura />}
      </>
      )}
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
        setError(data.error || 'Could not invite.');
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
      <strong>Invite someone to {proyectoNombre}</strong>
      <p className="muted" style={{ marginTop: 6 }}>They'll get an email to choose their own password.</p>
      <form onSubmit={onSubmit}>
        <input type="text" placeholder="Name" value={nombre} onChange={e => setNombre(e.target.value)} />
        <div style={{ height: 8 }} />
        <input type="text" placeholder="Email" value={usuario} onChange={e => setUsuario(e.target.value)} />
        <div style={{ height: 8 }} />
        <button type="submit" className="secundario" disabled={enviando}>{enviando ? 'Inviting...' : 'Invite'}</button>
        {error && <p className="error">{error}</p>}
      </form>
      {resultado && (
        <p className="muted" style={{ marginTop: 8 }}>
          Invitation sent. If email isn't set up yet, here's the link: <a href={resultado}>{resultado}</a>
        </p>
      )}
    </div>
  );
}
