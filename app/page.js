'use client';

import { useEffect, useState, useCallback } from 'react';
import TablaMovimientos from './components/TablaMovimientos';
import SubirFactura from './components/SubirFactura';
import SubirFacturasLote from './components/SubirFacturasLote';
import FacturasTrimestre from './components/FacturasTrimestre';
import GestionProyectos from './components/GestionProyectos';
import TablaColaboradores from './components/TablaColaboradores';
import Ayuda from './components/Ayuda';
import { ConfirmDialog } from './components/ConfirmDialog';
import { Modal } from './components/Modal';
import CabeceraApp, { PESTANAS } from './components/CabeceraApp';
import { apiFetch, mostrarToast } from './lib/toast';

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
      otrasFacturas: resultado.otrasFacturas, facturaId: resultado.facturaId,
      facturaConcepto: resultado.facturaConcepto,
    };
    ambiguos[resultado.movimientoId] = [...(ambiguos[resultado.movimientoId] || []), opcion];
  }
}

export default function Home() {
  const [proveedores, setProveedores] = useState(null);
  const [resumen, setResumen] = useState(null);
  const [facturas, setFacturas] = useState(null);
  const [proyectos, setProyectos] = useState([]);
  const [cargando, setCargando] = useState(false);
  // Histórico continuo: sin filtro, trae todo. Con datos de años se podrá
  // acotar aquí para no traer de más -- por ahora no hace falta un límite.
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [subiendoExcel, setSubiendoExcel] = useState(false);
  const [mensajeExcel, setMensajeExcel] = useState(null);
  const [mensajeFacturaSuelta, setMensajeFacturaSuelta] = useState(null);
  const [pestana, setPestana] = useState(() => {
    if (typeof window === 'undefined') return 'inicio';
    const tab = new URLSearchParams(window.location.search).get('tab');
    return PESTANAS.some(p => p.id === tab) ? tab : 'inicio';
  });
  const [lote, setLote] = useState(null);
  const [modalAbierto, setModalAbierto] = useState(null); // 'excel' | 'larpmanager' | 'larpmanager-pendientes' | 'devoluciones' | 'importaciones' | 'envio' | null
  const [recalculando, setRecalculando] = useState(false);
  const [subiendoLarpManager, setSubiendoLarpManager] = useState(false);
  const [mensajeLarpManager, setMensajeLarpManager] = useState(null);
  const [pagosSinEmparejar, setPagosSinEmparejar] = useState(null);
  const [cargandoPagosSinEmparejar, setCargandoPagosSinEmparejar] = useState(false);
  const [importaciones, setImportaciones] = useState(null);
  const [cargandoImportaciones, setCargandoImportaciones] = useState(false);
  const [devoluciones, setDevoluciones] = useState(null);
  const [cargandoDevoluciones, setCargandoDevoluciones] = useState(false);
  const [confirmarBorrarImportacion, setConfirmarBorrarImportacion] = useState(null); // { id, hoja, total, resueltas } | null
  const [borrandoImportacion, setBorrandoImportacion] = useState(false);
  const [envioHasta, setEnvioHasta] = useState('');
  const [envioEtiqueta, setEnvioEtiqueta] = useState('');
  const [envioPreview, setEnvioPreview] = useState(null);
  const [cargandoEnvioPreview, setCargandoEnvioPreview] = useState(false);
  const [generandoEnvio, setGenerandoEnvio] = useState(false);
  const [confirmarEnvio, setConfirmarEnvio] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const params = new URLSearchParams();
      if (desde) params.set('desde', desde);
      if (hasta) params.set('hasta', hasta);
      const qs = params.toString() ? `?${params.toString()}` : '';
      const [rp, rr, rf, rpy] = await Promise.all([
        apiFetch(`/api/movimientos${qs}`, undefined, { mensajeError: 'No se pudieron cargar los movimientos.' }),
        apiFetch('/api/resumen', undefined, { mensajeError: 'No se pudo cargar el resumen.' }),
        apiFetch('/api/facturas', undefined, { mensajeError: 'No se pudieron cargar las facturas.' }),
        apiFetch('/api/proyectos', undefined, { mensajeError: 'No se pudieron cargar los proyectos.' }),
      ]);
      setProveedores((rp && rp.proveedores) || []);
      setResumen(rr);
      setFacturas((rf && rf.facturas) || []);
      setProyectos((rpy && rpy.proyectos) || []);
    } finally {
      setCargando(false);
    }
  }, [desde, hasta]);

  useEffect(() => { cargar(); }, [cargar]);

  async function cerrarSesion() {
    await fetch('/api/logout', { method: 'POST' });
    window.location.href = '/login';
  }

  async function recalcularClaves() {
    setRecalculando(true);
    const r = await apiFetch('/api/recalcular-claves', { method: 'POST' }, {
      mensajeError: 'No se pudo recalcular.',
    });
    setRecalculando(false);
    if (r) {
      mostrarToast(`${r.cambiadas} de ${r.revisadas} línea(s) recalculadas`, 'ok');
      await cargar();
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
      const data = await apiFetch('/api/excels', { method: 'POST', body: formData }, {
        mensajeError: 'No se pudo importar el excel.',
      });
      if (data) {
        setMensajeExcel(`Importado: ${data.hojas.join(', ')}`);
        await cargar();
      }
    } finally {
      setSubiendoExcel(false);
      e.target.reset();
    }
  }

  // Sube el CSV de pagos de LarpManager y cruza sus filas Wire contra los
  // ingresos sin resolver por nombre (ver lib/larpmanager.cjs). El resultado
  // queda guardado en cada movimiento (larpmanager_candidatos), no en un
  // estado de este componente -- así el botón de confirmar sigue ahí aunque
  // se recargue la página o se vuelva más tarde, sin tener que subir el
  // mismo CSV otra vez.
  async function subirLarpManager(e) {
    e.preventDefault();
    const file = e.target.elements.file.files[0];
    if (!file) return;
    setSubiendoLarpManager(true);
    setMensajeLarpManager(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const data = await apiFetch('/api/larpmanager', { method: 'POST', body: formData }, {
        mensajeError: 'No se pudo procesar el CSV de LarpManager.',
      });
      if (data) {
        // Se dice también cuántas filas se guardaron sin cruzar, para que no
        // parezca que se han perdido: están todas, se pueden revisar después.
        setMensajeLarpManager(
          `${data.emparejadas} de ${data.resultados.length} ingreso(s) emparejados. ` +
          `Del CSV se han guardado ${data.totalFilasCsv} filas: ${data.filasCruzadas} se cruzan con el banco ` +
          `y ${data.filasGuardadasSinCruzar} no (pasarelas de pago y apuntes internos).`
        );
        await cargar();
      }
    } finally {
      setSubiendoLarpManager(false);
      e.target.reset();
    }
  }

  // Al revés que el cruce normal (banco -> LarpManager): aquí se pregunta
  // "¿qué pagos dice LarpManager que existen que ningún movimiento del banco
  // ha reclamado todavía?" -- el hueco que antes no se podía ver. Se pide
  // cada vez que se abre (no se guarda en estado aparte) para que siempre
  // refleje lo último confirmado en la tabla.
  async function verPagosSinEmparejar() {
    setModalAbierto('larpmanager-pendientes');
    setCargandoPagosSinEmparejar(true);
    const data = await apiFetch('/api/larpmanager-sin-emparejar', undefined, {
      mensajeError: 'No se pudo obtener la lista de pagos sin emparejar.',
    });
    setPagosSinEmparejar((data && data.pagos) || []);
    setCargandoPagosSinEmparejar(false);
  }

  // Revisión de las devoluciones pendientes de enviar -- también se incluyen
  // como pestaña propia en el excel del próximo envío a gestoría.
  async function verDevoluciones() {
    setModalAbierto('devoluciones');
    setCargandoDevoluciones(true);
    const data = await apiFetch('/api/devoluciones', undefined, {
      mensajeError: 'No se pudo obtener la lista de devoluciones.',
    });
    setDevoluciones((data && data.devoluciones) || []);
    setCargandoDevoluciones(false);
  }

  // Para cuando se sube el archivo equivocado por error (ej. el de otra
  // cuenta) y hace falta quitarlo entero para volver a subir el correcto,
  // sin que se mezclen los movimientos malos con los buenos. Cada excel
  // subido es su propia importación (no un singleton por banco), así que se
  // puede borrar una subida suelta sin tocar las demás.
  async function verImportaciones() {
    setModalAbierto('importaciones');
    setCargandoImportaciones(true);
    const data = await apiFetch('/api/importaciones', undefined, {
      mensajeError: 'No se pudo obtener la lista de excels subidos.',
    });
    setImportaciones((data && data.importaciones) || []);
    setCargandoImportaciones(false);
  }

  async function borrarImportacionConfirmada() {
    const importacionId = confirmarBorrarImportacion.id;
    setConfirmarBorrarImportacion(null);
    setBorrandoImportacion(true);
    const r = await apiFetch(`/api/importaciones/${importacionId}`, { method: 'DELETE' }, {
      mensajeError: 'No se pudo borrar.',
    });
    setBorrandoImportacion(false);
    if (r) {
      mostrarToast('Excel borrado.', 'ok');
      await verImportaciones();
      await cargar();
    }
  }

  // El envío a gestoría reemplaza a "cerrar trimestre": se revisa qué
  // entraría (todo lo resuelto y sin enviar hasta esa fecha, incluidas
  // facturas futuras recuperadas tarde de fechas anteriores) antes de
  // confirmar y descargar.
  function abrirEnvio() {
    setModalAbierto('envio');
    setEnvioHasta(new Date().toISOString().slice(0, 10));
    setEnvioEtiqueta('');
    setEnvioPreview(null);
  }

  useEffect(() => {
    if (modalAbierto !== 'envio' || !envioHasta) return;
    let cancelado = false;
    setCargandoEnvioPreview(true);
    apiFetch(`/api/envios?hasta=${envioHasta}`, undefined, { mensajeError: 'No se pudo calcular el envío.' })
      .then(r => { if (!cancelado) setEnvioPreview(r); })
      .finally(() => { if (!cancelado) setCargandoEnvioPreview(false); });
    return () => { cancelado = true; };
  }, [modalAbierto, envioHasta]);

  async function generarEnvio() {
    setGenerandoEnvio(true);
    try {
      const res = await fetch('/api/envios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hasta: envioHasta, etiqueta: envioEtiqueta || null }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        mostrarToast((data && data.error) || 'No se pudo generar el envío.', 'error');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(envioEtiqueta || `envio-${envioHasta}`).replace(/[^a-z0-9]+/gi, '-')}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      mostrarToast('Descarga lista.', 'ok');
      setModalAbierto(null);
      await cargar();
    } catch {
      mostrarToast('No se pudo generar el envío.', 'error');
    } finally {
      setGenerandoEnvio(false);
    }
  }

  // Junta los resultados de una subida en lote: qué líneas quedaron
  // resueltas solas, cuáles tienen varias facturas con el mismo importe
  // (para elegir en la tabla) y qué archivos no encontraron ninguna línea.
  // Subir facturas ya no cambia lo que se ve en Movimientos: ni lo filtra, ni
  // avisa allí de las que no encontraron línea. Eso vive en Facturas, que es
  // donde se suben. Lo único que sigue viajando es la lista de líneas con
  // varias facturas candidatas, para poder elegir desde la columna Nota.
  async function completarLote(resultados) {
    const ids = new Set();
    const ambiguos = {};

    for (const { resultado } of resultados) {
      if (['match_directo', 'ambiguo', 'combo_sugerido'].includes(resultado.tipo)) {
        clasificarResultado(resultado, ids, ambiguos);
      }
    }

    setLote({ ambiguos });
    await cargar();
  }

  const total = resumen?.total ?? 0;
  const resueltas = resumen?.resueltas ?? 0;
  const facturaFutura = resumen?.facturaFutura ?? 0;
  const ignoradas = resumen?.ignoradas ?? 0;
  // Factura futura no cuenta como "pendiente" urgente: no tiene sentido
  // reclamarla hasta que se cierre el proyecto (ver pestaña Proyectos).
  // Ignorada tampoco: es deliberadamente "no hay nada que hacer aquí".
  const pendientesMov = total - resueltas - facturaFutura - ignoradas;
  // Avance del punteo: de lo que de verdad necesita factura (ni ignorado ni
  // factura futura, que no dependen de nadie ahora mismo), cuánto está ya
  // resuelto. Es la única cifra que dice si esto se acerca a poder enviarse.
  const aPuntear = resueltas + pendientesMov;
  const avance = aPuntear > 0 ? Math.round((resueltas / aPuntear) * 100) : 0;

  return (
    <div className={(pestana === 'movimientos' || pestana === 'colaboradores' || pestana === 'facturas' || pestana === 'proyectos') ? 'contenedor contenedor-ancho' : 'contenedor'}>
      <CabeceraApp pestanaActiva={pestana} onCambiarPestana={setPestana} cerrarSesion={cerrarSesion} />

      {pestana === 'inicio' && (
        <div className="inicio-subir">
          <p className="titulo-inicio">Subir factura suelta</p>
          <p className="instruccion-inicio">Foto desde el móvil o PDF — se guarda y se empareja sola cuando toque.</p>
          <SubirFactura
            etiqueta="Subir ahora"
            className="grande"
            onResultado={r => { setMensajeFacturaSuelta(r.detalle); cargar(); }}
          />
          {mensajeFacturaSuelta && <p className="muted" style={{ marginTop: 10 }}>{mensajeFacturaSuelta}</p>}
        </div>
      )}

      {pestana === 'movimientos' && (
        <>
          <div className="bloques">
            <div className="bloque">
              <div className="btns">
                <button type="button" className="secundario btn-icono" title="Añadir excel del banco / paypal" onClick={() => setModalAbierto('excel')}>
                  <span className="ico">⬆</span>Excel del banco
                </button>
                <button type="button" className="secundario btn-icono" title="Subir pagos de LarpManager" onClick={() => setModalAbierto('larpmanager')}>
                  <span className="ico">⬆</span>Pagos de LarpManager
                </button>
              </div>
            </div>
            <div className="div-v" />
            <div className="bloque">
              <div className="btns">
                <button type="button" className="secundario" onClick={verPagosSinEmparejar}>Pagos sin emparejar</button>
                <button type="button" className="secundario" onClick={verDevoluciones}>Devoluciones</button>
                <button type="button" className="secundario" onClick={verImportaciones}>Archivos subidos</button>
              </div>
            </div>
            <div className="div-v" />
            <div className="bloque">
              <div className="btns">
                <button type="button" className="secundario" onClick={abrirEnvio}>Enviar a gestoría</button>
              </div>
            </div>
            {aPuntear > 0 && (
              <div className="bloque bloque-avance">
                <div className="progreso"><div style={{ width: `${avance}%` }} /></div>
                <span className="texto-avance" title="No cuentan las líneas ignoradas ni las de factura futura: no dependen de nadie ahora mismo.">
                  {resueltas} de {aPuntear} resueltos
                </span>
              </div>
            )}
          </div>

          {cargando && <p className="muted">Cargando...</p>}

          {proveedores && proveedores.length === 0 && (
            <p className="muted">Todavía no hay movimientos. Sube el excel del banco para empezar.</p>
          )}

          {proveedores && proveedores.length > 0 && (
            <TablaMovimientos
              proveedores={proveedores}
              proyectos={proyectos}
              onCambio={cargar}
              filtroLote={lote}
              desde={desde}
              hasta={hasta}
              onDesdeChange={setDesde}
              onHastaChange={setHasta}
              onRecalcular={recalcularClaves}
              recalculando={recalculando}
              pendientes={`${pendientesMov} pendiente${pendientesMov === 1 ? '' : 's'}`}
            />
          )}
        </>
      )}

      {pestana === 'facturas' && (
        <>
          <div className="fila" style={{ marginBottom: 14 }}>
            <SubirFacturasLote onCompletado={completarLote} />
          </div>
          {facturas && <FacturasTrimestre facturas={facturas} onCambio={cargar} />}
        </>
      )}

      {pestana === 'proyectos' && (
        <GestionProyectos proyectos={proyectos} onCambio={cargar} />
      )}

      {pestana === 'colaboradores' && (
        <TablaColaboradores />
      )}

      {pestana === 'ayuda' && (
        <Ayuda />
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
        <p className="muted">Sube el CSV de pagos que exportas de LarpManager. Se guarda entero y queda registrado en &quot;Archivos subidos&quot;. Contra el banco se cruzan las transferencias y las filas sin método de pago, que son las que acaban llegando a la cuenta; las de pasarela (Stripe, Redsys) y los apuntes internos (larpmoney, larpmanager) se guardan pero no se cruzan.</p>
        <form onSubmit={subirLarpManager}>
          <input type="file" name="file" accept=".csv" />
          <div style={{ height: 12 }} />
          <button type="submit" disabled={subiendoLarpManager}>{subiendoLarpManager ? 'Procesando...' : 'Subir'}</button>
        </form>
        {mensajeLarpManager && <p className="muted" style={{ marginTop: 8 }}>{mensajeLarpManager}</p>}
      </Modal>

      <Modal abierto={modalAbierto === 'larpmanager-pendientes'} titulo="Pagos de LarpManager sin emparejar" onCerrar={() => setModalAbierto(null)} ancho={760}>
        <p className="muted">Pagos que LarpManager dice que existen (transferencia o añadidos a mano) pero que ninguna línea del banco ha reclamado todavía. La columna &quot;Por qué&quot; dice el motivo de cada uno: antes todos se veían igual, sin distinguir si la transferencia no había llegado, si el importe no cuadraba o si el nombre coincidía a medias.</p>
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
                <th>Por qué</th>
              </tr>
            </thead>
            <tbody>
              {pagosSinEmparejar.map(p => (
                <tr key={p.id}>
                  <td>{p.nombre_real}</td>
                  <td>{p.evento}</td>
                  <td>{Number(p.importe).toFixed(2)}€</td>
                  <td>{p.fecha ? new Date(p.fecha).toLocaleDateString('es-ES') : '—'}</td>
                  <td className="muted">{p.motivoTexto || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Modal>

      <Modal abierto={modalAbierto === 'devoluciones'} titulo="Devoluciones sin enviar" onCerrar={() => setModalAbierto(null)}>
        <p className="muted">Se incluyen como pestaña propia ("Devoluciones") en el excel del próximo envío a gestoría.</p>
        {cargandoDevoluciones && <p className="muted">Cargando...</p>}
        {!cargandoDevoluciones && devoluciones && devoluciones.length === 0 && (
          <p className="muted">Ninguna devolución marcada todavía.</p>
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

      <Modal abierto={modalAbierto === 'importaciones'} titulo="Archivos subidos" onCerrar={() => setModalAbierto(null)} ancho={720}>
        <p className="muted">Los excels del banco y los CSV de LarpManager. Cada subida es independiente — borrar una no afecta a las demás.</p>
        {cargandoImportaciones && <p className="muted">Cargando...</p>}
        {!cargandoImportaciones && importaciones && importaciones.length === 0 && (
          <p className="muted">Todavía no se ha subido ningún archivo.</p>
        )}
        {!cargandoImportaciones && importaciones && importaciones.length > 0 && (
          <table style={{ width: '100%', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left' }}>
                <th>Tipo</th>
                <th>Origen</th>
                <th>Archivo</th>
                <th>Subido</th>
                {/* Sin cabecera: las dos clases de archivo traen cosas
                    distintas --el excel del banco trae movimientos que se
                    resuelven, el CSV de LarpManager trae pagos que se
                    emparejan-- y la propia celda ya dice de qué habla
                    ("75 pagos · 21 emparejados"). Cualquier título común
                    saldría forzado. */}
                <th></th>
                <th></th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {importaciones.map(imp => (
                <tr key={imp.id}>
                  <td>{imp.origen === 'larpmanager' ? 'LarpManager' : 'Banco'}</td>
                  <td className="muted">{imp.origen === 'larpmanager' ? '—' : imp.hoja}</td>
                  <td className="muted">{imp.nombreArchivo || '—'}</td>
                  <td className="muted">{imp.creadoEn ? new Date(imp.creadoEn).toLocaleDateString('es-ES') : '—'}</td>
                  <td>{imp.total} {imp.origen === 'larpmanager' ? 'pagos' : 'movimientos'}</td>
                  <td>{imp.resueltas} {imp.origen === 'larpmanager' ? 'emparejados' : 'resueltos'}</td>
                  <td>
                    <button type="button" className="secundario" disabled={borrandoImportacion} onClick={() => setConfirmarBorrarImportacion(imp)}>
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
        abierto={!!confirmarBorrarImportacion}
        titulo={confirmarBorrarImportacion?.origen === 'larpmanager'
          ? '¿Borrar este CSV de LarpManager?'
          : `¿Borrar este excel de ${confirmarBorrarImportacion?.hoja}?`}
        mensaje={
          confirmarBorrarImportacion?.origen === 'larpmanager'
            // Borrar un CSV no toca las líneas del banco: siguen resueltas y
            // con su nota. Solo se pierde la comprobación de que ese pago
            // llegó, y se recupera volviendo a subir el CSV.
            ? (confirmarBorrarImportacion?.resueltas > 0
              ? `Se borrarán los ${confirmarBorrarImportacion.total} pagos de esta subida — ${confirmarBorrarImportacion.resueltas} de ellos están emparejados con una línea del banco y perderán ese enlace. Las líneas del banco no se tocan: siguen resueltas y con su nota. Se recupera volviendo a subir el CSV.`
              : `Se borrarán los ${confirmarBorrarImportacion?.total} pagos de esta subida. Las líneas del banco no se tocan.`)
            : (confirmarBorrarImportacion?.resueltas > 0
              ? `Se borrarán los ${confirmarBorrarImportacion.total} movimientos de esta subida — ${confirmarBorrarImportacion.resueltas} de ellos ya están resueltos y se perderán sus notas/facturas emparejadas. No se puede deshacer.`
              : `Se borrarán los ${confirmarBorrarImportacion?.total} movimientos de esta subida. No se puede deshacer.`)
        }
        textoConfirmar="Borrar"
        peligroso
        onConfirmar={borrarImportacionConfirmada}
        onCancelar={() => setConfirmarBorrarImportacion(null)}
      />

      <Modal abierto={modalAbierto === 'envio'} titulo="Generar envío a gestoría" onCerrar={() => setModalAbierto(null)} ancho={520}>
        <p className="muted">Incluye todo lo resuelto y sin enviar todavía con fecha hasta el día elegido — también lo recuperado tarde de fechas anteriores (ej. una factura futura que llega después).</p>
        <div className="fila" style={{ gap: 8 }}>
          <label className="muted" style={{ fontSize: 13 }}>
            Hasta <input type="date" value={envioHasta} onChange={e => setEnvioHasta(e.target.value)} style={{ marginLeft: 4 }} />
          </label>
        </div>
        <div style={{ height: 8 }} />
        <input type="text" placeholder="Etiqueta (ej. Enero-Marzo 2026)" value={envioEtiqueta} onChange={e => setEnvioEtiqueta(e.target.value)} />
        <div style={{ height: 12 }} />
        {cargandoEnvioPreview && <p className="muted">Calculando...</p>}
        {!cargandoEnvioPreview && envioPreview && (
          envioPreview.movimientos === 0 ? (
            <p className="muted">No hay nada pendiente de enviar hasta esa fecha.</p>
          ) : (
            <p className="muted">
              {envioPreview.movimientos} movimiento(s) · {envioPreview.facturas} factura(s) · {envioPreview.devoluciones} devolución(es) · {envioPreview.importeTotal.toFixed(2)}€
            </p>
          )
        )}
        <div style={{ height: 8 }} />
        <button
          className="grande"
          disabled={generandoEnvio || !envioPreview || envioPreview.movimientos === 0}
          onClick={() => setConfirmarEnvio(true)}
        >
          {generandoEnvio ? 'Generando...' : 'Generar envío (descargar .zip)'}
        </button>
      </Modal>

      <ConfirmDialog
        abierto={confirmarEnvio}
        titulo="¿Generar el envío?"
        mensaje="Se descarga el .zip con las facturas numeradas y el excel final con las notas. Todo lo incluido queda marcado como ya enviado."
        textoConfirmar="Descargar"
        onConfirmar={() => { setConfirmarEnvio(false); generarEnvio(); }}
        onCancelar={() => setConfirmarEnvio(false)}
      />
    </div>
  );
}
