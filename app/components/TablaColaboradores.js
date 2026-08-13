'use client';

import { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../lib/toast';
import { Modal } from './Modal';

// Una fila por colaborador+proyecto (= un lote), así que quien está en dos
// proyectos aparece dos veces. El alta vive en un modal aparte (botón "+
// Añadir colaborador"): proyecto y "sube facturas de NOL" son campos
// independientes, nunca una elección excluyente -- un colaborador de
// proyecto puede además subir facturas que paga NOL directamente. Si la
// persona ya existe (mismo correo), se le añade el lote/permiso sin pedirle
// otra contraseña; si no existe, recibe una invitación por correo.
export default function TablaColaboradores() {
  const [filas, setFilas] = useState([]);
  const [proyectos, setProyectos] = useState([]);
  const [modalAbierto, setModalAbierto] = useState(false);
  const [nuevo, setNuevo] = useState({ nombre: '', usuario: '', proyectoId: '', puedeSubirFacturasGenerales: false });
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState(null);

  const cargar = useCallback(async () => {
    const [rl, rp] = await Promise.all([
      apiFetch('/api/lotes', undefined, { mensajeError: 'No se pudieron cargar los colaboradores.' }),
      apiFetch('/api/proyectos'),
    ]);
    setFilas((rl && rl.lotes) || []);
    setProyectos((rp && rp.proyectos) || []);
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  function abrirModal() {
    setNuevo({ nombre: '', usuario: '', proyectoId: '', puedeSubirFacturasGenerales: false });
    setResultado(null);
    setModalAbierto(true);
  }

  async function crear(e) {
    e.preventDefault();
    if (!nuevo.nombre || !nuevo.usuario || (!nuevo.proyectoId && !nuevo.puedeSubirFacturasGenerales)) return;
    setEnviando(true);
    try {
      const r = await apiFetch('/api/lotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nuevo),
      }, { mensajeError: 'No se pudo guardar.' });
      if (!r) return;
      if (r.yaExistia) {
        setResultado({ tipo: 'existente', nombre: r.colaborador.nombre });
      } else {
        setResultado({ tipo: 'invitado', enlace: r.enlace });
      }
      cargar();
    } finally {
      setEnviando(false);
    }
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
    <div>
      <div className="fila" style={{ marginBottom: 8 }}>
        <div>
          <strong>Colaboradores</strong>
          <p className="muted" style={{ margin: '4px 0 0' }}>Una fila por persona y proyecto — quien esté en dos proyectos aparece dos veces.</p>
        </div>
        <button type="button" className="secundario" onClick={abrirModal}>+ Añadir colaborador</button>
      </div>

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

      <Modal abierto={modalAbierto} titulo="Añadir colaborador" onCerrar={() => setModalAbierto(false)}>
        <form onSubmit={crear}>
          <div style={{ marginBottom: 14 }}>
            <span className="etiqueta">Nombre</span>
            <input type="text" placeholder="Nombre y apellidos" value={nuevo.nombre}
              onChange={e => setNuevo({ ...nuevo, nombre: e.target.value })} />
          </div>
          <div style={{ marginBottom: 14 }}>
            <span className="etiqueta">Correo</span>
            <input type="text" placeholder="correo@ejemplo.com" value={nuevo.usuario}
              onChange={e => setNuevo({ ...nuevo, usuario: e.target.value })} />
          </div>
          <div style={{ marginBottom: 14 }}>
            <span className="etiqueta">Proyecto (opcional)</span>
            <select value={nuevo.proyectoId} onChange={e => setNuevo({ ...nuevo, proyectoId: e.target.value })}>
              <option value="">Sin proyecto</option>
              {proyectos.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </div>
          <label className="fila dialogo-cuerpo" style={{ gap: 8, cursor: 'pointer', marginBottom: 14, justifyContent: 'flex-start' }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={nuevo.puedeSubirFacturasGenerales}
              onChange={e => setNuevo({ ...nuevo, puedeSubirFacturasGenerales: e.target.checked })} />
            También sube facturas pagadas por NOL directamente
          </label>
          <p className="dialogo-cuerpo" style={{ marginBottom: 14 }}>
            Si es una persona nueva, le llega un correo para que elija su propia contraseña. Si ya existe (mismo correo), solo se le añade el proyecto y/o el permiso.
          </p>
          <button type="submit" className="secundario" style={{ width: '100%' }} disabled={enviando}>
            {enviando ? 'Guardando...' : 'Invitar'}
          </button>
        </form>

        {resultado?.tipo === 'invitado' && (
          <p className="dialogo-cuerpo" style={{ marginTop: 12 }}>
            Invitación enviada. Si el correo aún no está configurado, este es el enlace: <a href={resultado.enlace}>{resultado.enlace}</a>
          </p>
        )}
        {resultado?.tipo === 'existente' && (
          <p className="dialogo-cuerpo" style={{ marginTop: 12 }}>
            {resultado.nombre} ya tenía cuenta — se ha actualizado sin mandar ningún correo nuevo.
          </p>
        )}
      </Modal>
    </div>
  );
}
