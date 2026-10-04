const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const { query, getPool } = require('./db.cjs');
const { descargarBlob } = require('./blob.cjs');
const { detectarHoja } = require('./hojaBanco.cjs');
const { cellText } = require('./cells.cjs');
const { listarDevolucionesEnRango } = require('./devoluciones.cjs');
const { pagosParaEnvio } = require('./pagos.cjs');
const sheetsConfig = require('../config/sheets.json').sheets;

async function etapa(nombre, fn) {
  try {
    return await fn();
  } catch (err) {
    const e = new Error(`[${nombre}] ${err.message}`);
    e.cause = err;
    throw e;
  }
}

const SELECT_MOVIMIENTO_DE_ENVIO = `SELECT m.id, m.hoja, m.fila, m.fecha, m.concepto, m.importe, m.nota_final,
            m.proyecto_id, m.importacion_id, m.es_devolucion,
            m.proveedor, m.jugador_larpmanager,
            p.nombre AS proyecto_nombre,
            m.datos_originales->>'larpmanager' AS larpmanager,
            COALESCE(
              (SELECT string_agg(f.numero::text, ', ' ORDER BY f.numero)
               FROM movimiento_facturas mf JOIN facturas f ON f.id = mf.factura_id
               WHERE mf.movimiento_id = m.id),
              ''
            ) AS facturas
     FROM movimientos m LEFT JOIN proyectos p ON p.id = m.proyecto_id`;

async function movimientosPendientesDeEnvio(hasta) {
  const { rows } = await query(
    `${SELECT_MOVIMIENTO_DE_ENVIO}
     WHERE m.envio_id IS NULL AND m.estado = 'resuelta' AND (m.fecha IS NULL OR m.fecha <= $1)
     ORDER BY m.fecha NULLS LAST`,
    [hasta]
  );
  return rows;
}

async function movimientosDeUnEnvio(envioId) {
  const { rows } = await query(
    `${SELECT_MOVIMIENTO_DE_ENVIO} WHERE m.envio_id = $1 ORDER BY m.fecha NULLS LAST`,
    [envioId]
  );
  return rows;
}

async function facturasDeMovimientos(movimientoIds) {
  if (movimientoIds.length === 0) return [];
  const { rows } = await query(
    `SELECT DISTINCT f.id, f.numero, f.ruta_blob, f.nombre_original
       FROM facturas f JOIN movimiento_facturas mf ON mf.factura_id = f.id
      WHERE mf.movimiento_id = ANY($1::bigint[])
      ORDER BY f.numero`,
    [movimientoIds]
  );
  return rows;
}

async function previsualizarEnvio(hasta) {
  const movimientos = await movimientosPendientesDeEnvio(hasta);
  const facturas = await facturasDeMovimientos(movimientos.map(m => m.id));
  const devoluciones = movimientos.filter(m => m.es_devolucion);
  return {
    movimientos: movimientos.length,
    facturas: facturas.length,
    devoluciones: devoluciones.length,
    importeTotal: movimientos.reduce((s, m) => s + Number(m.importe), 0),
  };
}

const COLUMNAS_APP = [
  { cabecera: 'Nota gestoría', valor: m => m.nota_final },
  { cabecera: 'Proveedor', valor: m => m.proveedor },
  { cabecera: 'Proyecto', valor: m => m.proyecto_nombre },
  { cabecera: 'Facturas', valor: m => m.facturas },
  { cabecera: 'Jugador', valor: m => m.jugador_larpmanager },
  { cabecera: 'LarpManager', valor: m => m.larpmanager },
];

function firmaDeCabecera(ws, filaCabecera) {
  const fila = ws.getRow(filaCabecera);
  const total = Math.max(ws.columnCount || 0, fila.cellCount || 0);
  const nombres = [];
  for (let c = 1; c <= total; c++) nombres.push(cellText(fila, c));
  while (nombres.length > 0 && !nombres[nombres.length - 1]) nombres.pop();
  return nombres.join('|');
}

function copiarFila(origen, destino) {
  origen.eachCell({ includeEmpty: true }, (celda, columna) => {
    const nueva = destino.getCell(columna);
    if (celda.type !== ExcelJS.ValueType.Merge) nueva.value = celda.value;
    nueva.style = { ...celda.style };
  });
}

function copiarCombinadas(origen, destino, hastaFila) {
  for (const rango of (origen.model.merges || [])) {
    const filas = rango.match(/\d+/g).map(Number);
    if (Math.max(...filas) <= hastaFila) destino.mergeCells(rango);
  }
}

function nombreLibre(libro, base) {
  const usados = new Set(libro.worksheets.map(w => w.name));
  let nombre = base;
  let sufijo = 2;
  while (usados.has(nombre)) nombre = `${base} (${sufijo++})`;
  return nombre;
}

async function generarExcelFinal(movimientos, etiqueta, { descargar = descargarBlob } = {}) {
  const importacionIds = [...new Set(movimientos.map(m => m.importacion_id).filter(Boolean))];
  if (importacionIds.length === 0) throw new Error('Ninguno de los movimientos de este envío viene de un excel subido (raro -- revisa a mano).');

  const { rows: importaciones } = await query(
    `SELECT id, hoja, ruta_blob FROM importaciones WHERE id = ANY($1::bigint[]) ORDER BY id`,
    [importacionIds]
  );

  const libros = new Map();
  for (const imp of importaciones) {
    if (libros.has(imp.ruta_blob)) continue;
    const buf = await etapa(`descargar excel original ${imp.ruta_blob}`, () => descargar(imp.ruta_blob));
    const wb = new ExcelJS.Workbook();
    await etapa(`cargar excel original ${imp.ruta_blob}`, () => wb.xlsx.load(buf));
    libros.set(imp.ruta_blob, wb);
  }

  const grupos = [];
  for (const imp of importaciones) {
    const ws = libros.get(imp.ruta_blob).getWorksheet(imp.hoja) || libros.get(imp.ruta_blob).worksheets[0];
    const cfg = sheetsConfig.find(c => c.nombre === imp.hoja);
    const detectado = cfg && cfg.modo === 'nombres' ? detectarHoja(ws, cfg) : null;
    const firma = detectado ? firmaDeCabecera(ws, detectado.filaCabecera) : null;
    let grupo = firma ? grupos.find(g => g.hoja === imp.hoja && g.firma === firma) : null;
    if (!grupo) {
      grupo = { hoja: imp.hoja, firma, base: ws, detectado, importaciones: [] };
      grupos.push(grupo);
    }
    grupo.importaciones.push({ id: imp.id, ws });
  }

  const wbFinal = new ExcelJS.Workbook();
  const movimientoPorId = new Map(movimientos.map(m => [String(m.id), m]));

  await etapa('juntar los excels de cada banco en una sola pestaña', async () => {
    for (const grupo of grupos) {
      const ws = wbFinal.addWorksheet(nombreLibre(wbFinal, grupo.hoja));

      if (!grupo.detectado) {
        grupo.base.eachRow({ includeEmpty: true }, (fila, numero) => copiarFila(fila, ws.getRow(numero)));
        copiarCombinadas(grupo.base, ws, Infinity);
        continue;
      }

      const { filaCabecera, notaCol } = grupo.detectado;
      for (let r = 1; r <= filaCabecera; r++) copiarFila(grupo.base.getRow(r), ws.getRow(r));
      copiarCombinadas(grupo.base, ws, filaCabecera);
      for (let c = 1; c <= (grupo.base.columnCount || 0); c++) {
        const ancho = grupo.base.getColumn(c).width;
        if (ancho) ws.getColumn(c).width = ancho;
      }
      COLUMNAS_APP.forEach((col, i) => { ws.getRow(filaCabecera).getCell(notaCol + i).value = col.cabecera; });

      const hojaDeCadaImportacion = new Map(grupo.importaciones.map(i => [String(i.id), i.ws]));
      const { rows: lineas } = await query(
        `SELECT id, importacion_id, fila FROM movimientos
          WHERE importacion_id = ANY($1::bigint[])
          ORDER BY fecha NULLS LAST, importacion_id, fila`,
        [grupo.importaciones.map(i => i.id)]
      );

      let destino = filaCabecera;
      for (const linea of lineas) {
        destino++;
        const fila = ws.getRow(destino);
        copiarFila(hojaDeCadaImportacion.get(String(linea.importacion_id)).getRow(linea.fila), fila);
        const m = movimientoPorId.get(String(linea.id));
        if (!m) continue;
        COLUMNAS_APP.forEach((col, i) => {
          const v = col.valor(m);
          if (v !== null && v !== undefined && v !== '') fila.getCell(notaCol + i).value = v;
        });
      }
    }
  });

  await etapa('escribir pestaña de devoluciones', async () => {
    const idsDevolucion = movimientos.filter(m => m.es_devolucion).map(m => m.id);
    if (idsDevolucion.length === 0) return;
    const devoluciones = await listarDevolucionesEnRango();
    const enEsteEnvio = devoluciones.filter(d => idsDevolucion.includes(d.id));
    if (enEsteEnvio.length === 0) return;
    const ws = wbFinal.addWorksheet('Devoluciones');
    ws.addRow(['Fecha', 'Importe', 'Proyecto', 'Jugador (LarpManager)', 'Nota']);
    for (const d of enEsteEnvio) {
      ws.addRow([
        d.fecha ? new Date(d.fecha).toLocaleDateString('es-ES') : '',
        Number(d.importe),
        d.proyecto || '',
        d.jugador_larpmanager || '',
        d.nota_final || '',
      ]);
    }
  });

  await etapa('escribir una hoja por cada pago a colaboradores', async () => {
    const pagos = await pagosParaEnvio(movimientos.map(m => m.id));
    if (pagos.length === 0) return;
    const nombresUsadosPago = new Set(wbFinal.worksheets.map(w => w.name));
    for (const p of pagos) {
      let nombreHoja = `Pago ${p.colaborador_nombre}`.slice(0, 28);
      let sufijo = 2;
      while (nombresUsadosPago.has(nombreHoja)) { nombreHoja = `${nombreHoja} (${sufijo++})`.slice(0, 31); }
      nombresUsadosPago.add(nombreHoja);

      const ws = wbFinal.addWorksheet(nombreHoja);
      ws.addRow([p.colaborador_nombre, p.proyecto_nombre]);
      ws.addRow([]);
      ws.addRow(['Factura', 'Concepto', 'Importe']);
      for (const f of p.facturas) {
        ws.addRow([f.numero, f.concepto || '', f.importe]);
      }
      ws.addRow([]);
      ws.addRow(['Anticipo', 'Fecha', 'Importe', 'Forma de pago']);
      for (const a of p.anticipos) {
        ws.addRow(['', a.fecha ? new Date(a.fecha).toLocaleDateString('es-ES') : '', Number(a.importe), a.es_efectivo ? 'efectivo' : 'banco']);
      }
      ws.addRow([]);
      ws.addRow(['Total', '', Number(p.importe)]);
    }
  });

  return etapa('generar buffer del excel final', () => wbFinal.xlsx.writeBuffer());
}

function nombreArchivoBase(etiqueta, hasta) {
  return etiqueta ? etiqueta.replace(/[^a-z0-9]+/gi, '-') : `envio-${hasta}`;
}

function rechazo(mensaje, status = 409) {
  return Object.assign(new Error(mensaje), { status });
}

async function facturasDeUnEnvio(envioId) {
  const { rows } = await query(
    `SELECT id, numero, ruta_blob, nombre_original FROM facturas WHERE envio_id = $1 ORDER BY numero`,
    [envioId]
  );
  return rows;
}

async function construirZip({ movimientos, facturas, etiqueta, hasta, descargar = descargarBlob }) {
  const excelBuffer = await generarExcelFinal(movimientos, etiqueta, { descargar });

  const zip = new JSZip();
  zip.file(`${nombreArchivoBase(etiqueta, hasta)}.xlsx`, excelBuffer);
  for (const f of facturas) {
    const ext = (f.nombre_original || '').split('.').pop() || 'pdf';
    await etapa(`añadir factura ${f.numero} (${f.nombre_original || 'sin nombre'}) al zip`, async () => {
      const buf = await descargar(f.ruta_blob);
      zip.file(`facturas/${f.numero}.${ext}`, buf);
    });
  }

  return etapa('generar el zip', () => zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
}

async function descargarEnvio({ hasta, etiqueta }, { descargar } = {}) {
  const movimientos = await movimientosPendientesDeEnvio(hasta);
  if (movimientos.length === 0) throw rechazo('No hay nada pendiente de enviar hasta esa fecha.');
  const facturas = await facturasDeMovimientos(movimientos.map(m => m.id));
  return construirZip({ movimientos, facturas, etiqueta, hasta, descargar });
}

async function marcarComoEnviado({ hasta, etiqueta, desde }) {
  const movimientos = await movimientosPendientesDeEnvio(hasta);
  if (movimientos.length === 0) throw rechazo('No hay nada pendiente de enviar hasta esa fecha.');
  const movimientoIds = movimientos.map(m => m.id);
  const facturas = await facturasDeMovimientos(movimientoIds);

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO envios_gestoria (etiqueta, desde, hasta) VALUES ($1,$2,$3) RETURNING id`,
      [etiqueta || null, desde || null, hasta]
    );
    const envioId = rows[0].id;
    await client.query(`UPDATE movimientos SET envio_id = $1 WHERE id = ANY($2::bigint[])`, [envioId, movimientoIds]);
    if (facturas.length > 0) {
      await client.query(`UPDATE facturas SET envio_id = $1 WHERE id = ANY($2::bigint[])`, [envioId, facturas.map(f => f.id)]);
    }
    await client.query('COMMIT');
    return { envioId: Number(envioId), movimientos: movimientoIds.length, facturas: facturas.length };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function listarEnvios() {
  const { rows } = await query(
    `SELECT e.id, e.etiqueta, to_char(e.desde, 'YYYY-MM-DD') AS desde, to_char(e.hasta, 'YYYY-MM-DD') AS hasta, e.creado_en,
            (SELECT COUNT(*) FROM movimientos m WHERE m.envio_id = e.id) AS movimientos,
            (SELECT COUNT(*) FROM facturas f WHERE f.envio_id = e.id) AS facturas
       FROM envios_gestoria e
      ORDER BY e.id DESC`
  );
  return rows.map(r => ({ ...r, id: Number(r.id), movimientos: Number(r.movimientos), facturas: Number(r.facturas) }));
}

async function descargarEnvioHecho(envioId, { descargar } = {}) {
  const { rows: [envio] } = await query(
    `SELECT id, etiqueta, to_char(hasta, 'YYYY-MM-DD') AS hasta FROM envios_gestoria WHERE id = $1`, [envioId]
  );
  if (!envio) throw rechazo('Ese envío ya no existe: recarga la lista.', 404);
  const movimientos = await movimientosDeUnEnvio(envioId);
  if (movimientos.length === 0) throw rechazo('Ese envío no tiene ningún movimiento.');
  const facturas = await facturasDeUnEnvio(envioId);
  const zip = await construirZip({ movimientos, facturas, etiqueta: envio.etiqueta, hasta: envio.hasta, descargar });
  return { zip, nombre: nombreArchivoBase(envio.etiqueta, envio.hasta) };
}

async function deshacerEnvio(envioId) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const { rows: [envio] } = await client.query(`SELECT id FROM envios_gestoria WHERE id = $1 FOR UPDATE`, [envioId]);
    if (!envio) throw rechazo('Ese envío ya no existe: recarga la lista.', 404);
    const { rowCount: movimientos } = await client.query(`UPDATE movimientos SET envio_id = NULL WHERE envio_id = $1`, [envioId]);
    const { rowCount: facturas } = await client.query(`UPDATE facturas SET envio_id = NULL WHERE envio_id = $1`, [envioId]);
    await client.query(`DELETE FROM envios_gestoria WHERE id = $1`, [envioId]);
    await client.query('COMMIT');
    return { movimientos, facturas };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

module.exports = {
  previsualizarEnvio, descargarEnvio, marcarComoEnviado, listarEnvios, descargarEnvioHecho, deshacerEnvio,
  facturasDeMovimientos, generarExcelFinal,
};
