const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const { query } = require('./db.cjs');
const { descargarBlob } = require('./blob.cjs');
const { detectarHoja } = require('./hojaBanco.cjs');
const { listarDevolucionesEnRango } = require('./devoluciones.cjs');
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

async function movimientosPendientesDeEnvio(hasta) {
  const { rows } = await query(
    `SELECT m.id, m.hoja, m.fila, m.fecha, m.concepto, m.importe, m.nota_final,
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
     FROM movimientos m LEFT JOIN proyectos p ON p.id = m.proyecto_id
     WHERE m.envio_id IS NULL AND m.estado = 'resuelta' AND (m.fecha IS NULL OR m.fecha <= $1)
     ORDER BY m.fecha NULLS LAST`,
    [hasta]
  );
  return rows;
}

async function facturasDeMovimientos(movimientoIds) {
  if (movimientoIds.length === 0) return [];
  const { rows } = await query(
    `SELECT f.id, f.numero, f.ruta_blob, f.nombre_original
       FROM facturas f JOIN movimiento_facturas mf ON mf.factura_id = f.id
      WHERE mf.movimiento_id = ANY($1::bigint[])
        AND f.lote_id IS NULL AND f.estado = 'matcheada' AND f.trimestre_id IS NULL
     UNION
     SELECT f.id, f.numero, f.ruta_blob, f.nombre_original
       FROM facturas f
       JOIN pago_facturas pf ON pf.factura_id = f.id
       JOIN pagos pg ON pg.id = pf.pago_id
      WHERE pg.movimiento_id = ANY($1::bigint[]) AND f.lote_id IS NOT NULL
     ORDER BY numero`,
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

async function generarExcelFinal(movimientos, etiqueta) {
  const importacionIds = [...new Set(movimientos.map(m => m.importacion_id).filter(Boolean))];
  if (importacionIds.length === 0) throw new Error('Ninguno de los movimientos de este envío viene de un excel subido (raro -- revisa a mano).');

  const { rows: importaciones } = await query(
    `SELECT id, hoja, ruta_blob FROM importaciones WHERE id = ANY($1::bigint[])`,
    [importacionIds]
  );

  const workbooksPorImportacion = new Map();
  for (const imp of importaciones) {
    const buf = await etapa(`descargar excel original ${imp.ruta_blob}`, () => descargarBlob(imp.ruta_blob));
    const wb = new ExcelJS.Workbook();
    await etapa(`cargar excel original ${imp.ruta_blob}`, () => wb.xlsx.load(buf));
    workbooksPorImportacion.set(imp.id, wb);
  }

  let wbFinal;
  if (importaciones.length === 1) {
    wbFinal = workbooksPorImportacion.get(importaciones[0].id);

    if (!wbFinal.getWorksheet(importaciones[0].hoja)) {
      wbFinal.worksheets[0].name = importaciones[0].hoja;
    }
  } else {

    wbFinal = new ExcelJS.Workbook();
    const nombresUsados = new Set();
    await etapa('combinar excels originales', async () => {
      for (const imp of importaciones) {
        const wbOrigen = workbooksPorImportacion.get(imp.id);
        const wsOrigen = wbOrigen.getWorksheet(imp.hoja) || wbOrigen.worksheets[0];
        let nombreHoja = imp.hoja;
        let sufijo = 2;
        while (nombresUsados.has(nombreHoja)) { nombreHoja = `${imp.hoja} (${sufijo++})`; }
        nombresUsados.add(nombreHoja);
        imp.hojaFinal = nombreHoja;
        const wsNueva = wbFinal.addWorksheet(nombreHoja);
        wsOrigen.eachRow({ includeEmpty: true }, (row, rn) => {
          const nueva = wsNueva.getRow(rn);
          row.eachCell({ includeEmpty: true }, (cell, cn) => { nueva.getCell(cn).value = cell.value; });
          nueva.commit();
        });
      }
    });
  }

  const hojaFinalPorImportacion = new Map(importaciones.map(imp => [imp.id, imp.hojaFinal || imp.hoja]));

  const COLUMNAS_APP = [
    { cabecera: 'Nota gestoría', valor: m => m.nota_final },
    { cabecera: 'Proveedor', valor: m => m.proveedor },
    { cabecera: 'Proyecto', valor: m => m.proyecto_nombre },
    { cabecera: 'Facturas', valor: m => m.facturas },
    { cabecera: 'Jugador', valor: m => m.jugador_larpmanager },
    { cabecera: 'LarpManager', valor: m => m.larpmanager },
  ];

  await etapa('escribir columnas de la app en el excel final', async () => {
    for (const imp of importaciones) {
      const ws = wbFinal.getWorksheet(hojaFinalPorImportacion.get(imp.id));
      if (!ws) continue;
      const cfg = sheetsConfig.find(c => c.nombre === imp.hoja);
      const movimientosHoja = movimientos.filter(m => m.importacion_id === imp.id);
      if (movimientosHoja.length === 0) continue;

      let primeraCol, filaCabecera = null;
      if (cfg && cfg.modo === 'nombres') {
        const detectado = detectarHoja(ws, cfg);
        if (!detectado) continue;
        primeraCol = detectado.notaCol;
        filaCabecera = detectado.filaCabecera;
      } else if (cfg && cfg.notaCol) {
        primeraCol = cfg.notaCol;
      } else {
        continue;
      }

      COLUMNAS_APP.forEach((col, i) => {
        if (filaCabecera !== null) {
          ws.getRow(filaCabecera).getCell(primeraCol + i).value = col.cabecera;
        }
        for (const m of movimientosHoja) {
          const v = col.valor(m);
          if (v !== null && v !== undefined && v !== '') {
            ws.getRow(m.fila).getCell(primeraCol + i).value = v;
          }
        }
      });
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

  return etapa('generar buffer del excel final', () => wbFinal.xlsx.writeBuffer());
}

async function confirmarEnvio({ hasta, etiqueta, desde }) {
  const movimientos = await movimientosPendientesDeEnvio(hasta);
  if (movimientos.length === 0) throw new Error('No hay nada pendiente de enviar hasta esa fecha.');
  const facturas = await facturasDeMovimientos(movimientos.map(m => m.id));

  const excelBuffer = await generarExcelFinal(movimientos, etiqueta);

  const zip = new JSZip();
  const nombreArchivoBase = etiqueta ? etiqueta.replace(/[^a-z0-9]+/gi, '-') : `envio-${hasta}`;
  zip.file(`${nombreArchivoBase}.xlsx`, excelBuffer);
  for (const f of facturas) {
    const ext = (f.nombre_original || '').split('.').pop() || 'pdf';
    await etapa(`añadir factura ${f.numero} (${f.nombre_original || 'sin nombre'}) al zip`, async () => {
      const buf = await descargarBlob(f.ruta_blob);
      zip.file(`facturas/${f.numero}.${ext}`, buf);
    });
  }

  const zipBuffer = await etapa('generar el zip', () => zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));

  const { rows: envioRows } = await query(
    `INSERT INTO envios_gestoria (etiqueta, desde, hasta) VALUES ($1,$2,$3) RETURNING id`,
    [etiqueta || null, desde || null, hasta]
  );
  const envioId = envioRows[0].id;

  await query(`UPDATE movimientos SET envio_id = $1 WHERE id = ANY($2::bigint[])`, [envioId, movimientos.map(m => m.id)]);
  if (facturas.length > 0) {
    await query(`UPDATE facturas SET envio_id = $1 WHERE id = ANY($2::bigint[])`, [envioId, facturas.map(f => f.id)]);
  }

  return zipBuffer;
}

module.exports = { previsualizarEnvio, confirmarEnvio };
