'use client';

import { useEffect, useState, useCallback } from 'react';
import TablaMovimientos from './components/TablaMovimientos';
import SubirFactura from './components/SubirFactura';
import SubirFacturasLote from './components/SubirFacturasLote';
import FacturasTrimestre from './components/FacturasTrimestre';
import SelectorTrimestre from './components/SelectorTrimestre';
import SeccionLotes from './components/SeccionLotes';
import NuevoColaborador from './components/NuevoColaborador';
import { ConfirmDialog } from './components/ConfirmDialog';
import { Modal } from './components/Modal';
import { apiFetch } from './lib/toast';

const PESTANAS = [
  { id: 'inicio', etiqueta: 'Inicio' },
  { id: 'trimestre', etiqueta: 'Trimestre' },
  { id: 'colaboradores', etiqueta: 'Colaboradores' },
  { id: 'admin', etiqueta: 'Admin' },
];

// Clasifica un resultado de matching (de la subida en lote o de fijar un
// importe a mano) en los mismos ids/ambiguos que ya sabe pintar la tabla.
function clasificarResultado(resultado, ids, ambiguos) {
  if (resultado.tipo === 'match_directo') {
    ids.add(resultado.movimientoId);
  } else if (resultado.tipo === 'ambiguo') {
    for (const c of resultado.candidatos) {
      ids.add(c.movimientoId);
      const opcion = { movimientoId: c.movimientoId, numero: resultado.numero, facturaId: resultado.facturaId, facturaConcepto: resultado.facturaConcepto };
      ambiguos[c.movimientoId] = [...(ambiguos[c.movimientoId] || []), opcion];
    }
  } else if (resultado.tipo === 'combo_sugerido') {
    ids.add(resultado.movimientoId);
    const opcion = {
      movimientoId: resultado.movimientoId, esCombo: true, numero: resultado.numero,
      otraFacturaNumero: resultado.otraFacturaNumero, facturaId: resultado.facturaId, otraFacturaId: resultado.otraFacturaId,
      facturaConcepto: resultado.facturaConcepto,
    };
    ambiguos[resultado.movimientoId] = [...(ambiguos[resultado.movimientoId] || []), opcion];
  }
}

export default function Home() {
  const [trimestreId, setTrimestreId] = useState('');
  const [proveedores, setProveedores] = useState(null);
  const [resumen, setResumen] = useState(null);
  const [facturas, setFacturas] = useState(null);
  const [proyectos, setProyectos] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [subiendoExcel, setSubiendoExcel] = useState(false);
  const [mensajeExcel, setMensajeExcel] = useState(null);
  const [mensajeFacturaSuelta, setMensajeFacturaSuelta] = useState(null);
  const [pestana, setPestana] = useState('inicio');
  const [confirmarCierre, setConfirmarCierre] = useState(false);
  const [lote, setLote] = useState(null);
  const [modalAbierto, setModalAbierto] = useState(null); // 'facturas' | 'excel' | 'cierre' | null

  useEffect(() => {
    const guardado = localStorage.getItem('trimestreId');
    if (guardado) setTrimestreId(guardado);
  }, []);

  const cargar = useCallback(async id => {
    if (!id) return;
    setCargando(true);
    try {
      const [rp, rr, rf, rpy] = await Promise.all([
        apiFetch(`/api/trimestres/${id}/proveedores`, undefined, { mensajeError: 'No se pudieron cargar los proveedores.' }),
        apiFetch(`/api/trimestres/${id}/resumen`, undefined, { mensajeError: 'No se pudo cargar el resumen.' }),
        apiFetch(`/api/trimestres/${id}/facturas`, undefined, { mensajeError: 'No se pudieron cargar las facturas.' }),
        apiFetch('/api/proyectos', undefined, { mensajeError: 'No se pudieron cargar los proyectos.' }),
      ]);
      setProveedores((rp && rp.proveedores) || []);
      setResumen(rr);
      setFacturas((rf && rf.facturas) || []);
      setProyectos((rpy && rpy.proyectos) || []);
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

  function cambiarTrimestre() {
    localStorage.removeItem('trimestreId');
    setTrimestreId('');
    setProveedores(null);
  }

  async function cerrarSesion() {
    await fetch('/api/logout', { method: 'POST' });
    window.location.href = '/login';
  }

  function irAPendientes() {
    setPestana('trimestre');
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

  // Junta los resultados de una subida en lote: qué líneas quedaron
  // resueltas solas, cuáles tienen varias facturas con el mismo importe
  // (para elegir en la tabla) y qué archivos no encontraron ninguna línea.
  async function completarLote(resultados) {
    const ids = new Set();
    const ambiguos = {};
    const sinEncontrar = [];

    for (const { nombreArchivo, resultado } of resultados) {
      if (['match_directo', 'ambiguo', 'combo_sugerido'].includes(resultado.tipo)) {
        clasificarResultado(resultado, ids, ambiguos);
      } else {
        sinEncontrar.push({ nombreArchivo, facturaId: resultado.facturaId, detalle: resultado.detalle });
      }
    }

    setLote({ ids, ambiguos, sinEncontrar, total: resultados.length });
    await cargar(trimestreId);
  }

  // Cuando el importe no se pudo leer del PDF, se escribe a mano y esto
  // relanza el mismo matching automático contra los movimientos pendientes.
  async function resolverImporteManual(facturaId, nombreArchivo, importe) {
    const resultado = await apiFetch(`/api/facturas/${facturaId}/importe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ importe }),
    }, { mensajeError: 'No se pudo guardar el importe.' });
    if (!resultado) return;

    setLote(prev => {
      if (!prev) return prev;
      const ids = new Set(prev.ids);
      const ambiguos = { ...prev.ambiguos };
      const sinEncontrar = prev.sinEncontrar.filter(f => f.facturaId !== facturaId);

      if (['match_directo', 'ambiguo', 'combo_sugerido'].includes(resultado.tipo)) {
        clasificarResultado(resultado, ids, ambiguos);
      } else {
        sinEncontrar.push({ nombreArchivo, facturaId, detalle: resultado.detalle });
      }

      return { ...prev, ids, ambiguos, sinEncontrar };
    });
    await cargar(trimestreId);
  }

  if (!trimestreId) {
    return <SelectorTrimestre onEntrar={entrarTrimestre} />;
  }

  const total = resumen?.total ?? 0;
  const resueltas = resumen?.resueltas ?? 0;
  const porcentaje = total ? Math.round((resueltas / total) * 100) : 0;

  return (
    <div className={pestana === 'trimestre' ? 'contenedor contenedor-ancho' : 'contenedor'}>
      <h1 style={{ margin: '16px 0 0' }}>{trimestreId}</h1>

      <div className="tabbar">
        {PESTANAS.map(p => (
          <button key={p.id} className={pestana === p.id ? 'activa' : ''} onClick={() => setPestana(p.id)}>
            {p.etiqueta}
          </button>
        ))}
      </div>

      {pestana === 'inicio' && (
        <>
          <div className="cta-principal">
            <p>Subir factura suelta</p>
            <div className="sub">Foto desde el móvil o PDF — se guarda y se empareja sola cuando toque.</div>
            <SubirFactura
              trimestreId={trimestreId}
              etiqueta="Subir ahora"
              onResultado={r => { setMensajeFacturaSuelta(r.detalle); cargar(trimestreId); }}
            />
          </div>
          {mensajeFacturaSuelta && <p className="muted" style={{ marginTop: -6, marginBottom: 12 }}>{mensajeFacturaSuelta}</p>}

          <div className="resumen-mini">
            <div>
              <span>{resueltas} de {total} líneas resueltas</span>
              <div className="progreso" style={{ width: 120, margin: '6px 0 0' }}><div style={{ width: `${porcentaje}%` }} /></div>
            </div>
            <a href="#" onClick={e => { e.preventDefault(); irAPendientes(); }}>Ver pendientes →</a>
          </div>

          {facturas && facturas.length > 0 && (() => {
            const sueltas = facturas.filter(f => !f.proveedor_clave);
            const pendientes = facturas.filter(f => f.estado !== 'matcheada');
            return (
              <p className="muted">
                {facturas.length} factura(s) subida(s) — {pendientes.length} sin resolver todavía
                {sueltas.length > 0 ? ` (${sueltas.length} sin proveedor asignado aún)` : ''}.
              </p>
            );
          })()}
        </>
      )}

      {pestana === 'trimestre' && (
        <>
          <div className="resumen-mini">
            <div>
              <span>{resueltas} de {total} líneas resueltas</span>
              <div className="progreso" style={{ width: 200, margin: '6px 0 0' }}><div style={{ width: `${porcentaje}%` }} /></div>
            </div>
          </div>

          <div className="fila" style={{ gap: 8, marginBottom: 14, justifyContent: 'flex-start', flexWrap: 'wrap' }}>
            <SubirFacturasLote trimestreId={trimestreId} onCompletado={completarLote} />
            <button type="button" className="secundario" onClick={() => setModalAbierto('facturas')}>Ver / borrar facturas</button>
            <button type="button" className="secundario" onClick={() => setModalAbierto('excel')}>Añadir excel</button>
            <button type="button" className="secundario" onClick={() => setModalAbierto('cierre')}>Cerrar trimestre</button>
          </div>

          {cargando && <p className="muted">Cargando...</p>}

          {proveedores && proveedores.length === 0 && (
            <p className="muted">Todavía no hay movimientos. Sube el excel del trimestre para empezar.</p>
          )}

          {proveedores && proveedores.length > 0 && (
            <TablaMovimientos
              trimestreId={trimestreId}
              proveedores={proveedores}
              proyectos={proyectos}
              onCambio={() => cargar(trimestreId)}
              filtroLote={lote}
              onQuitarFiltro={() => setLote(null)}
              onResolverImporteManual={resolverImporteManual}
            />
          )}
        </>
      )}

      {pestana === 'colaboradores' && (
        <SeccionLotes trimestreId={trimestreId} />
      )}

      {pestana === 'admin' && (
        <>
          <div className="tarjeta">
            <strong>Proyectos</strong>
            <p className="muted">Lista de proyectos/eventos, compartida entre trimestres.</p>
            <a href="/proyectos"><button type="button" className="secundario">Ver proyectos</button></a>
          </div>

          <div className="tarjeta">
            <NuevoColaborador />
          </div>

          <div className="tarjeta">
            <strong>Trimestre</strong>
            <p className="muted">Estás en {trimestreId}.</p>
            <button type="button" className="secundario" onClick={cambiarTrimestre}>Cambiar trimestre</button>
          </div>

          <div className="tarjeta">
            <button type="button" className="secundario" onClick={cerrarSesion}>Cerrar sesión</button>
          </div>
        </>
      )}

      <Modal abierto={modalAbierto === 'facturas'} titulo="Ver / borrar facturas" onCerrar={() => setModalAbierto(null)} ancho={720}>
        <FacturasTrimestre trimestreId={trimestreId} facturas={facturas || []} onCambio={() => cargar(trimestreId)} />
      </Modal>

      <Modal abierto={modalAbierto === 'excel'} titulo="Añadir excel del banco / paypal" onCerrar={() => setModalAbierto(null)}>
        <p className="muted">Si es el excel combinado (bbva/openbank/paypal en pestañas), déjalo en "Detectar automáticamente". Si es un export suelto de un solo banco, indícalo.</p>
        <form onSubmit={subirExcel}>
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
        {mensajeExcel && <p className="muted" style={{ marginTop: 8 }}>{mensajeExcel}</p>}
      </Modal>

      <Modal abierto={modalAbierto === 'cierre'} titulo="Cerrar trimestre" onCerrar={() => setModalAbierto(null)}>
        <p className="muted">Descarga el .zip con las facturas numeradas y el excel final con las notas — hazlo cuando ya esté todo punteado.</p>
        <button className="grande" onClick={() => { setModalAbierto(null); setConfirmarCierre(true); }}>Cerrar trimestre (descargar .zip)</button>
      </Modal>

      <ConfirmDialog
        abierto={confirmarCierre}
        titulo="¿Cerrar el trimestre?"
        mensaje="Se descarga el .zip con las facturas numeradas y el excel final con las notas."
        textoConfirmar="Descargar"
        onConfirmar={() => { setConfirmarCierre(false); window.location.href = `/api/trimestres/${trimestreId}/cerrar`; }}
        onCancelar={() => setConfirmarCierre(false)}
      />
    </div>
  );
}
