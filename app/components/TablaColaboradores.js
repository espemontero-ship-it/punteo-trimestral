'use client';

import { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../lib/toast';
import { Modal } from './Modal';

export default function TablaColaboradores() {
  const [filas, setFilas] = useState([]);
  const [modalAbierto, setModalAbierto] = useState(false);
  const [nuevo, setNuevo] = useState({ nombre: '', usuario: '', puedeSubirFacturasGenerales: false });
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState(null);

  const cargar = useCallback(async () => {
    const rl = await apiFetch('/api/lotes', undefined, { mensajeError: 'No se pudieron cargar los colaboradores.' });
    setFilas((rl && rl.lotes) || []);
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  function abrirModal() {
    setNuevo({ nombre: '', usuario: '', puedeSubirFacturasGenerales: false });
    setResultado(null);
    setModalAbierto(true);
  }

  async function crear(e) {
    e.preventDefault();
    if (!nuevo.nombre || !nuevo.usuario) return;
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
          <p className="muted" style={{ margin: '4px 0 0' }}>Una fila por persona; quien ya haya subido algo a varios proyectos aparece una fila por proyecto.</p>
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
            <div key={l.id || `c${l.colaborador_id}`} role="row" className="fila-tabla" style={{ gridTemplateColumns: '1fr 1fr 130px 90px 110px 140px' }}>
              <div role="cell" className="celda">
                {l.id ? <a href={`/lotes/${l.id}`} style={{ color: 'inherit' }}>{l.colaborador_nombre}</a> : l.colaborador_nombre}
              </div>
              <div role="cell" className="celda muted">{l.colaborador_usuario}</div>
              <div role="cell" className="celda muted">{l.evento || '—'}</div>
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
          <label className="fila dialogo-cuerpo" style={{ gap: 8, cursor: 'pointer', marginBottom: 14, justifyContent: 'flex-start' }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={nuevo.puedeSubirFacturasGenerales}
              onChange={e => setNuevo({ ...nuevo, puedeSubirFacturasGenerales: e.target.checked })} />
            También puede subir facturas pagadas por NOL directamente
          </label>
          <p className="dialogo-cuerpo" style={{ marginBottom: 14 }}>
            Elige él mismo a qué proyecto sube cada factura, no hace falta asignarle uno aquí. Si es una persona nueva, le llega un correo para que elija su propia contraseña. Si ya existe (mismo correo), solo se le actualiza el permiso.
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
