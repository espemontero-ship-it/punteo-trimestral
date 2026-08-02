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
import { apiFetch, mostrarToast } from './lib/toast';

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
  const [modalAbierto, setModalAbierto] = useState(null); // 'excel' | 'cierre' | null
  const [vistaFacturas, setVistaFacturas] = useState(false);
  const [recalculando, setRecalculando] = useState(false);
  const [cerrando, setCerrando] = useState(false);
  const [subiendoLarpManager, setSubiendoLarpManager] = useState(false);
  const [mensajeLarpManager, setMensajeLarpManager] = useState(null);
  const [pagosSinEmparejar, setPagosSinEmparejar] = useState(null);
  const [cargandoPagosSinEmparejar, setCargandoPagosSinEmparejar] = useState(false);
  const [hojasSubidas, setHojasSubidas] = useState(null);
  const [cargandoHojas, setCargandoHojas] = useState(false);
  const [devoluciones, setDevoluciones] = useState(null);
  const [cargandoDevoluciones, setCargandoDevoluciones] = useState(false);
  const [confirmarBorrarHoja, setConfirmarBorrarHoja] = useState(null); // { hoja, total, resueltas } | null
  const [borrandoHoja, setBorrandoHoja] = useState(false);

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

  async function recalcularClaves() {
    setRecalculando(true);
    const r = await apiFetch(`/api/trimestres/${trimestreId}/recalcular-claves`, { method: 'POST' }, {
      mensajeError: 'No se pudo recalcular.',
    });
    setRecalculando(false);
    if (r) {
      mostrarToast(`${r.cambiadas} de ${r.revisadas} línea(s) recalculadas`, 'ok');
      await cargar(trimestreId);
    }
  }

  function irAPendientes() {
    setPestana('trimestre');
  }

  async function cerrarTrimestre() {
    setCerrando(true);
    try {
      const res = await fetch(`/api/trimestres/${trimestreId}/cerrar`);
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        mostrarToast((data && data.error) || 'No se pudo cerrar el trimestre.', 'error');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `punteo-${trimestreId}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      mostrarToast('Descarga lista.', 'ok');
    } catch {
      mostrarToast('No se pudo cerrar el trimestre.', 'error');
    } finally {
      setCerrando(false);
    }
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

  // Sube el CSV de pagos de LarpManager y cruza sus filas Wire contra los
  // ingresos sin resolver del trimestre por nombre (ver lib/larpmanager.cjs).
  // El resultado queda guardado en cada movimiento (larpmanager_candidatos),
  // no en un estado de este componente -- así el botón de confirmar sigue
  // ahí aunque se recargue la página o se vuelva más tarde, sin tener que
  // subir el mismo CSV otra vez.
  async function subirLarpManager(e) {
    e.preventDefault();
    const file = e.target.elements.file.files[0];
    if (!file) return;
    setSubiendoLarpManager(true);
    setMensajeLarpManager(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const data = await apiFetch(`/api/trimestres/${trimestreId}/larpmanager`, { method: 'POST', body: formData }, {
        mensajeError: 'No se pudo procesar el CSV de LarpManager.',
      });
      if (data) {
        setMensajeLarpManager(`${data.emparejadas} de ${data.resultados.length} ingreso(s) emparejados con LarpManager.`);
        await cargar(trimestreId);
      }
    } finally {
      setSubiendoLarpManager(false);
      e.target.reset();
    }
  }

  // Al revés que el cruce normal (banco -> LarpManager): aquí se pregunta
  // "¿qué pagos dice LarpManager que existen que ninguna línea del banco ha
  // reclamado todavía?" -- el hueco que antes no se podía ver. Se pide cada
  // vez que se abre (no se guarda en estado aparte) para que siempre
  // refleje lo último confirmado en la tabla.
  async function verPagosSinEmparejar() {
    setModalAbierto('larpmanager-pendientes');
    setCargandoPagosSinEmparejar(true);
    const data = await apiFetch(`/api/trimestres/${trimestreId}/larpmanager-sin-emparejar`, undefined, {
      mensajeError: 'No se pudo obtener la lista de pagos sin emparejar.',
    });
    setPagosSinEmparejar((data && data.pagos) || []);
    setCargandoPagosSinEmparejar(false);
  }

  // Revisión antes de cerrar el trimestre (pestaña "Devoluciones" del excel
  // final) y para la declaración de IVA del trimestre.
  async function verDevoluciones() {
    setModalAbierto('devoluciones');
    setCargandoDevoluciones(true);
    const data = await apiFetch(`/api/trimestres/${trimestreId}/devoluciones`, undefined, {
      mensajeError: 'No se pudo obtener la lista de devoluciones.',
    });
    setDevoluciones((data && data.devoluciones) || []);
    setCargandoDevoluciones(false);
  }

  // Para cuando se sube el excel equivocado por error (ej. el de otra
  // cuenta) y hace falta quitarlo entero para volver a subir el correcto,
  // sin que se mezclen los movimientos malos con los buenos.
  async function verHojas() {
    setModalAbierto('hojas');
    setCargandoHojas(true);
    const data = await apiFetch(`/api/trimestres/${trimestreId}/hojas`, undefined, {
      mensajeError: 'No se pudo obtener la lista de excels subidos.',
    });
    setHojasSubidas((data && data.hojas) || []);
    setCargandoHojas(false);
  }

  async function borrarHojaConfirmada() {
    const hoja = confirmarBorrarHoja.hoja;
    setConfirmarBorrarHoja(null);
    setBorrandoHoja(true);
    const r = await apiFetch(`/api/trimestres/${trimestreId}/hojas/${hoja}`, { method: 'DELETE' }, {
      mensajeError: 'No se pudo borrar.',
    });
    setBorrandoHoja(false);
    if (r) {
      mostrarToast(`Excel de ${hoja} borrado.`, 'ok');
      await verHojas();
      await cargar(trimestreId);
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
  const facturaFutura = resumen?.facturaFutura ?? 0;
  // No cuenta como "pendiente" urgente: no tiene sentido reclamarla hasta
  // que se cierre el proyecto (ver /proyectos, "Ver devoluciones").
  const pendientesMov = total - resueltas - facturaFutura;

  if (vistaFacturas) {
    return (
      <div className="contenedor contenedor-ancho">
        <div className="fila" style={{ margin: '16px 0 4px' }}>
          <h1 style={{ margin: 0 }}>Facturas — {trimestreId}</h1>
          <button type="button" className="secundario" onClick={() => setVistaFacturas(false)}>← Volver a Trimestre</button>
        </div>
        <FacturasTrimestre trimestreId={trimestreId} facturas={facturas || []} onCambio={() => cargar(trimestreId)} />
      </div>
    );
  }

  return (
    <div className={pestana === 'trimestre' ? 'contenedor contenedor-ancho' : 'contenedor'}>
      <div className="fila" style={{ margin: '16px 0 8px' }}>
        <h1 style={{ margin: 0 }}>{trimestreId}</h1>
        <a href="#" className="muted" style={{ fontSize: 13 }} onClick={e => { e.preventDefault(); irAPendientes(); }}>
          {pendientesMov} pendiente{pendientesMov === 1 ? '' : 's'}
        </a>
      </div>

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
          <div className="fila" style={{ gap: 8, marginBottom: 14, justifyContent: 'flex-start', flexWrap: 'wrap' }}>
            <SubirFacturasLote trimestreId={trimestreId} onCompletado={completarLote} />
            <button type="button" className="secundario" onClick={() => setVistaFacturas(true)}>Ver / borrar facturas</button>
            <button type="button" className="secundario" onClick={() => setModalAbierto('excel')}>Añadir excel</button>
            <button type="button" className="secundario" onClick={() => setModalAbierto('larpmanager')}>Subir LarpManager</button>
            <button type="button" className="secundario" onClick={verPagosSinEmparejar}>Ver pagos de LarpManager sin emparejar</button>
            <button type="button" className="secundario" onClick={verDevoluciones}>Ver devoluciones</button>
            <button type="button" className="secundario" onClick={() => setModalAbierto('cierre')}>Cerrar trimestre</button>
            <button type="button" className="secundario" disabled={recalculando} onClick={recalcularClaves}>
              {recalculando ? 'Recalculando...' : 'Recalcular agrupación'}
            </button>
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
            <strong>Excels subidos</strong>
            <p className="muted">Para cuando subes el archivo equivocado por error — borra todos los movimientos de ese banco en este trimestre para volver a subir el correcto sin que se mezclen.</p>
            <button type="button" className="secundario" onClick={verHojas}>Ver / borrar excels subidos</button>
          </div>

          <div className="tarjeta">
            <button type="button" className="secundario" onClick={cerrarSesion}>Cerrar sesión</button>
          </div>
        </>
      )}

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

      <Modal abierto={modalAbierto === 'larpmanager'} titulo="Subir pagos de LarpManager" onCerrar={() => setModalAbierto(null)}>
        <p className="muted">Sube el CSV de pagos que exportas de LarpManager — solo se usan las filas por transferencia (Wire); el resto se ignora. Cruza por nombre contra los ingresos sin resolver de este trimestre.</p>
        <form onSubmit={subirLarpManager}>
          <input type="file" name="file" accept=".csv" />
          <div style={{ height: 12 }} />
          <button type="submit" disabled={subiendoLarpManager}>{subiendoLarpManager ? 'Procesando...' : 'Subir'}</button>
        </form>
        {mensajeLarpManager && <p className="muted" style={{ marginTop: 8 }}>{mensajeLarpManager}</p>}
      </Modal>

      <Modal abierto={modalAbierto === 'larpmanager-pendientes'} titulo="Pagos de LarpManager sin emparejar" onCerrar={() => setModalAbierto(null)}>
        <p className="muted">Pagos que LarpManager dice que existen (transferencia o añadidos a mano) pero que ninguna línea del banco de este trimestre ha reclamado todavía — puede ser que la transferencia no haya llegado, que el nombre no se reconozca, o que el excel del banco de esa fecha aún no esté subido.</p>
        {cargandoPagosSinEmparejar && <p className="muted">Cargando...</p>}
        {!cargandoPagosSinEmparejar && pagosSinEmparejar && pagosSinEmparejar.length === 0 && (
          <p className="muted">Ninguno — todos los pagos de LarpManager subidos ya están emparejados.</p>
        )}
        {!cargandoPagosSinEmparejar && pagosSinEmparejar && pagosSinEmparejar.length > 0 && (
          <table style={{ width: '100%', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left' }}>
                <th>Nombre</th>
                <th>Evento</th>
                <th>Importe</th>
                <th>Fecha</th>
              </tr>
            </thead>
            <tbody>
              {pagosSinEmparejar.map(p => (
                <tr key={p.id}>
                  <td>{p.nombre_real}</td>
                  <td>{p.evento}</td>
                  <td>{Number(p.importe).toFixed(2)}€</td>
                  <td>{p.fecha ? new Date(p.fecha).toLocaleDateString('es-ES') : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Modal>

      <Modal abierto={modalAbierto === 'devoluciones'} titulo="Devoluciones de este trimestre" onCerrar={() => setModalAbierto(null)}>
        <p className="muted">Se incluyen como pestaña propia ("Devoluciones") en el excel final al cerrar el trimestre.</p>
        {cargandoDevoluciones && <p className="muted">Cargando...</p>}
        {!cargandoDevoluciones && devoluciones && devoluciones.length === 0 && (
          <p className="muted">Ninguna devolución marcada todavía en este trimestre.</p>
        )}
        {!cargandoDevoluciones && devoluciones && devoluciones.length > 0 && (
          <table style={{ width: '100%', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left' }}>
                <th>Fecha</th>
                <th>Importe</th>
                <th>Proyecto</th>
                <th>Jugador (LarpManager)</th>
                <th>Nota</th>
              </tr>
            </thead>
            <tbody>
              {devoluciones.map(d => (
                <tr key={d.id}>
                  <td>{d.fecha ? new Date(d.fecha).toLocaleDateString('es-ES') : '—'}</td>
                  <td>{Number(d.importe).toFixed(2)}€</td>
                  <td>{d.proyecto || '—'}</td>
                  <td>{d.jugador_larpmanager || '—'}</td>
                  <td>{d.nota_final || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Modal>

      <Modal abierto={modalAbierto === 'hojas'} titulo="Excels subidos en este trimestre" onCerrar={() => setModalAbierto(null)}>
        {cargandoHojas && <p className="muted">Cargando...</p>}
        {!cargandoHojas && hojasSubidas && hojasSubidas.length === 0 && (
          <p className="muted">Todavía no se ha subido ningún excel de banco en este trimestre.</p>
        )}
        {!cargandoHojas && hojasSubidas && hojasSubidas.length > 0 && (
          <table style={{ width: '100%', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left' }}>
                <th>Banco</th>
                <th>Movimientos</th>
                <th>Resueltos</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {hojasSubidas.map(h => (
                <tr key={h.hoja}>
                  <td>{h.hoja}</td>
                  <td>{h.total}</td>
                  <td>{h.resueltas}</td>
                  <td>
                    <button type="button" className="secundario" disabled={borrandoHoja} onClick={() => setConfirmarBorrarHoja(h)}>
                      Borrar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Modal>

      <ConfirmDialog
        abierto={!!confirmarBorrarHoja}
        titulo={`¿Borrar el excel de ${confirmarBorrarHoja?.hoja}?`}
        mensaje={
          confirmarBorrarHoja?.resueltas > 0
            ? `Se borrarán los ${confirmarBorrarHoja.total} movimientos de ${confirmarBorrarHoja.hoja} de este trimestre — ${confirmarBorrarHoja.resueltas} de ellos ya están resueltos y se perderán sus notas/facturas emparejadas. No se puede deshacer.`
            : `Se borrarán los ${confirmarBorrarHoja?.total} movimientos de ${confirmarBorrarHoja?.hoja} de este trimestre. No se puede deshacer.`
        }
        textoConfirmar="Borrar"
        peligroso
        onConfirmar={borrarHojaConfirmada}
        onCancelar={() => setConfirmarBorrarHoja(null)}
      />

      <Modal abierto={modalAbierto === 'cierre'} titulo="Cerrar trimestre" onCerrar={() => setModalAbierto(null)}>
        <p className="muted">Descarga el .zip con las facturas numeradas y el excel final con las notas — hazlo cuando ya esté todo punteado.</p>
        <button className="grande" onClick={() => { setModalAbierto(null); setConfirmarCierre(true); }}>Cerrar trimestre (descargar .zip)</button>
      </Modal>

      <ConfirmDialog
        abierto={confirmarCierre}
        titulo="¿Cerrar el trimestre?"
        mensaje="Se descarga el .zip con las facturas numeradas y el excel final con las notas."
        textoConfirmar="Descargar"
        onConfirmar={() => { setConfirmarCierre(false); cerrarTrimestre(); }}
        onCancelar={() => setConfirmarCierre(false)}
      />
    </div>
  );
}
