'use client';

import { useEffect, useState, useCallback } from 'react';
import TablaMovimientos from './components/TablaMovimientos';
import SubirFactura from './components/SubirFactura';
import SubirFacturasLote from './components/SubirFacturasLote';
import FacturasTrimestre from './components/FacturasTrimestre';
import GestionProyectos from './components/GestionProyectos';
import TablaColaboradores from './components/TablaColaboradores';
import PagosLarpManager from './components/PagosLarpManager';
import Ayuda from './components/Ayuda';
import { ConfirmDialog } from './components/ConfirmDialog';
import { Modal } from './components/Modal';
import CabeceraApp, { PESTANAS } from './components/CabeceraApp';
import { apiFetch, mostrarToast } from './lib/toast';

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
  const [modalAbierto, setModalAbierto] = useState(null);
  const [recalculando, setRecalculando] = useState(false);
  const [subiendoLarpManager, setSubiendoLarpManager] = useState(false);
  const [mensajeLarpManager, setMensajeLarpManager] = useState(null);
  const [cargandoPagosSinEmparejar, setCargandoPagosSinEmparejar] = useState(false);

  const [lineaElegida, setLineaElegida] = useState('');
  const [guardandoVinculo, setGuardandoVinculo] = useState(false);
  const [importaciones, setImportaciones] = useState(null);
  const [cargandoImportaciones, setCargandoImportaciones] = useState(false);
  const [devoluciones, setDevoluciones] = useState(null);
  const [cargandoDevoluciones, setCargandoDevoluciones] = useState(false);
  const [confirmarBorrarImportacion, setConfirmarBorrarImportacion] = useState(null);
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

  async function verDevoluciones() {
    setModalAbierto('devoluciones');
    setCargandoDevoluciones(true);
    const data = await apiFetch('/api/devoluciones', undefined, {
      mensajeError: 'No se pudo obtener la lista de devoluciones.',
    });
    setDevoluciones((data && data.devoluciones) || []);
    setCargandoDevoluciones(false);
  }

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

  async function completarLote(resultados) {
    const ids = new Set();
    const ambiguos = {};

    for (const { resultado } of resultados) {
      if (['match_directo', 'ambiguo', 'combo_sugerido'].includes(resultado.tipo)) {
        clasificarResultado(resultado, ids, ambiguos);
      }
    }

    const repetidos = resultados.filter(r => r.resultado?.tipo === 'duplicada');
    if (repetidos.length) {
      mostrarToast(repetidos.length === 1
        ? repetidos[0].resultado.detalle
        : `${repetidos.length} archivos no se han subido porque ya estaban: ${repetidos.map(r => r.nombreArchivo).join(", ")}`,
        'error');
    }

    setLote({ ambiguos });
    await cargar();
  }

  const total = resumen?.total ?? 0;
  const resueltas = resumen?.resueltas ?? 0;
  const facturaFutura = resumen?.facturaFutura ?? 0;
  const ignoradas = resumen?.ignoradas ?? 0;

  const pendientesMov = total - resueltas - facturaFutura - ignoradas;

  const aPuntear = resueltas + pendientesMov;
  const avance = aPuntear > 0 ? Math.round((resueltas / aPuntear) * 100) : 0;

  return (
    <div className={(pestana === 'movimientos' || pestana === 'colaboradores' || pestana === 'facturas' || pestana === 'proyectos' || pestana === 'larpmanager') ? 'contenedor contenedor-ancho' : 'contenedor'}>
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
              </div>
            </div>
            <div className="div-v" />
            <div className="bloque">
              <div className="btns">
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

      {pestana === 'larpmanager' && (
        <PagosLarpManager onAbrirSubida={() => setModalAbierto('larpmanager')} onCambio={cargar} />
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
          <input type="file" name="file" accept=".csv,.xlsx,.xls" />
          <div style={{ height: 12 }} />
          <button type="submit" disabled={subiendoLarpManager}>{subiendoLarpManager ? 'Procesando...' : 'Subir'}</button>
        </form>
        {mensajeLarpManager && <p className="muted" style={{ marginTop: 8 }}>{mensajeLarpManager}</p>}
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

            ? (confirmarBorrarImportacion?.resueltas > 0
              ? `Se borrarán los ${confirmarBorrarImportacion.total} pagos de esta subida — ${confirmarBorrarImportacion.resueltas} de ellos están emparejados con un movimiento y perderán ese enlace. Los movimientos no se tocan: siguen resueltos y con su nota. Se recupera volviendo a subir el CSV.`
              : `Se borrarán los ${confirmarBorrarImportacion?.total} pagos de esta subida. Los movimientos no se tocan.`)
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
