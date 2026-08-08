'use client';

import { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../lib/toast';

// Una fila por colaborador+proyecto (= un lote), así que quien está en dos
// proyectos aparece dos veces. Alta y asignación de proyecto viven en la misma
// fila siempre visible: escribir el mismo nombre/correo con otro proyecto
// añade un lote nuevo sin duplicar a la persona ni pedir contraseña otra vez.
export default function TablaColaboradores() {
  const [filas, setFilas] = useState([]);
  const [proyectos, setProyectos] = useState([]);
  const [nuevaFila, setNuevaFila] = useState({ nombre: '', usuario: '', proyecto: '' });
  const [passwordGenerada, setPasswordGenerada] = useState(null);

  const cargar = useCallback(async () => {
    const [rl, rp] = await Promise.all([
      apiFetch('/api/lotes', undefined, { mensajeError: 'No se pudieron cargar los colaboradores.' }),
      apiFetch('/api/proyectos'),
    ]);
    setFilas((rl && rl.lotes) || []);
    setProyectos((rp && rp.proyectos) || []);
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  async function crear(e) {
    e.preventDefault();
    if (!nuevaFila.nombre || !nuevaFila.usuario || !nuevaFila.proyecto) return;
    const r = await apiFetch('/api/lotes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(nuevaFila),
    }, { mensajeError: 'No se pudo guardar.' });
    if (!r) return;
    setPasswordGenerada(r.password ? { usuario: r.colaborador.usuario, password: r.password } : null);
    setNuevaFila({ nombre: '', usuario: '', proyecto: '' });
    cargar();
  }

  async function cambiarEstado(colaboradorId, estado) {
    const r = await apiFetch(`/api/colaboradores/${colaboradorId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ estado }),
    }, { mensajeError: 'No se pudo actualizar el estado.' });
    if (r) cargar();
  }

  async function cambiarPuedeInvitar(colaboradorId, puedeInvitar) {
    const r = await apiFetch(`/api/colaboradores/${colaboradorId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ puedeInvitar }),
    }, { mensajeError: 'No se pudo actualizar el permiso.' });
    if (r) cargar();
  }

  async function cambiarPuedeSubirFacturasGenerales(colaboradorId, puedeSubirFacturasGenerales) {
    const r = await apiFetch(`/api/colaboradores/${colaboradorId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ puedeSubirFacturasGenerales }),
    }, { mensajeError: 'No se pudo actualizar el permiso.' });
    if (r) cargar();
  }

  return (
    <>
    <div className="tarjeta">
      <strong>Colaboradores</strong>
      <p className="muted">Una fila por persona y proyecto — quien esté en dos proyectos aparece dos veces. Asignar un proyecto aquí es lo que crea su lote de cuentas.</p>

      <div className="tabla-movimientos-envoltura" role="table" style={{ marginTop: 8 }}>
        <div role="rowgroup">
          <div role="row" className="fila-tabla-cabecera" style={{ gridTemplateColumns: '1fr 1fr 130px 90px 110px 140px' }}>
            <div role="columnheader" className="celda">Nombre</div>
            <div role="columnheader" className="celda">Correo</div>
            <div role="columnheader" className="celda">Proyecto</div>
            <div role="columnheader" className="celda">Estado</div>
            <div role="columnheader" className="celda">Puede invitar</div>
            <div role="columnheader" className="celda">Sube facturas NOL</div>
          </div>
        </div>
        <div role="rowgroup">
          <form role="row" className="fila-tabla" style={{ gridTemplateColumns: '1fr 1fr 130px 90px 110px 140px' }} onSubmit={crear}>
            <div role="cell" className="celda">
              <input className="campo-proveedor" type="text" placeholder="Nombre" value={nuevaFila.nombre}
                onChange={e => setNuevaFila({ ...nuevaFila, nombre: e.target.value })} />
            </div>
            <div role="cell" className="celda">
              <input className="campo-proveedor" type="text" placeholder="Correo" value={nuevaFila.usuario}
                onChange={e => setNuevaFila({ ...nuevaFila, usuario: e.target.value })} />
            </div>
            <div role="cell" className="celda">
              <select className="select-proyecto" style={{ width: '100%' }} value={nuevaFila.proyecto}
                onChange={e => setNuevaFila({ ...nuevaFila, proyecto: e.target.value })}>
                <option value="">Elige proyecto...</option>
                {proyectos.map(p => <option key={p.id} value={p.nombre}>{p.nombre}</option>)}
              </select>
            </div>
            <div role="cell" className="celda">
              <button type="submit" className="secundario">Añadir</button>
            </div>
            <div role="cell" className="celda"></div>
            <div role="cell" className="celda"></div>
          </form>

          {filas.map(l => (
            <div key={l.id} role="row" className="fila-tabla" style={{ gridTemplateColumns: '1fr 1fr 130px 90px 110px 140px' }}>
              <div role="cell" className="celda"><a href={`/lotes/${l.id}`} style={{ color: 'inherit' }}>{l.colaborador_nombre}</a></div>
              <div role="cell" className="celda muted">{l.colaborador_usuario}</div>
              <div role="cell" className="celda">{l.evento}</div>
              <div role="cell" className="celda">
                <select className="select-estado" value={l.colaborador_estado} onChange={e => cambiarEstado(l.colaborador_id, e.target.value)}>
                  <option value="activo">activo</option>
                  <option value="inactivo">inactivo</option>
                </select>
              </div>
              <div role="cell" className="celda">
                <select className="select-estado" value={l.colaborador_puede_invitar ? 'si' : 'no'} onChange={e => cambiarPuedeInvitar(l.colaborador_id, e.target.value === 'si')}>
                  <option value="no">no</option>
                  <option value="si">sí</option>
                </select>
              </div>
              <div role="cell" className="celda">
                <select className="select-estado" value={l.colaborador_puede_subir_facturas_generales ? 'si' : 'no'} onChange={e => cambiarPuedeSubirFacturasGenerales(l.colaborador_id, e.target.value === 'si')}>
                  <option value="no">no</option>
                  <option value="si">sí</option>
                </select>
              </div>
            </div>
          ))}
        </div>
      </div>

      {passwordGenerada && (
        <p className="muted" style={{ marginTop: 8 }}>
          Correo: <strong>{passwordGenerada.usuario}</strong> · Contraseña: <strong>{passwordGenerada.password}</strong>
          <br />Apúntala ahora — no se puede volver a ver.
        </p>
      )}
    </div>
    <InvitarAsistenteFacturas />
    </>
  );
}

// Alguien que te asiste subiendo facturas de gastos de NOL (no de un
// proyecto concreto) -- no hace falta proyecto, así que va aparte de la fila
// de alta de arriba (que siempre crea un lote).
function InvitarAsistenteFacturas() {
  const [nombre, setNombre] = useState('');
  const [usuario, setUsuario] = useState('');
  const [resultado, setResultado] = useState(null);
  const [enviando, setEnviando] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    if (!nombre || !usuario) return;
    setEnviando(true);
    try {
      const r = await apiFetch('/api/colaboradores/invitar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre, usuario }),
      }, { mensajeError: 'No se pudo invitar.' });
      if (!r) return;
      setResultado(r.enlace);
      setNombre('');
      setUsuario('');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="tarjeta">
      <strong>Dar acceso para subir facturas de NOL</strong>
      <p className="muted" style={{ marginTop: 6 }}>Para cuando alguien te asiste subiendo gastos de la asociación (no de un proyecto concreto) — recibe un correo para elegir su propia contraseña.</p>
      <form onSubmit={onSubmit}>
        <input type="text" placeholder="Nombre" value={nombre} onChange={e => setNombre(e.target.value)} />
        <div style={{ height: 8 }} />
        <input type="text" placeholder="Correo" value={usuario} onChange={e => setUsuario(e.target.value)} />
        <div style={{ height: 8 }} />
        <button type="submit" className="secundario" disabled={enviando}>{enviando ? 'Invitando...' : 'Invitar'}</button>
      </form>
      {resultado && (
        <p className="muted" style={{ marginTop: 8 }}>
          Invitación enviada. Si el correo aún no está configurado, este es el enlace: <a href={resultado}>{resultado}</a>
        </p>
      )}
    </div>
  );
}
