const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const { query } = require('./db.cjs');
const { descargarBlob } = require('./blob.cjs');
const { detectarHoja } = require('./hojaBanco.cjs');
const { listarDevolucionesEnRango } = require('./devoluciones.cjs');
const sheetsConfig = require('../config/sheets.json').sheets;

// Envuelve una etapa con su nombre para que, si algo revienta con un error
// minificado en producción (tipo "i is not a function"), el mensaje diga al
// menos EN QUÉ ETAPA pasó — si no, es imposible saber dónde mirar sin acceso
// a los logs de Vercel.
async function etapa(nombre, fn) {
  try {
    return await fn();
  } catch (err) {
    const e = new Error(`[${nombre}] ${err.message}`);
    e.cause = err;
    throw e;
  }
}

// Un envío a gestoría ya no es "cerrar un trimestre": es un paquete que
// cubre un rango de fechas, generado cuando haga falta. Se marca cada
// movimiento/factura incluido con su envio_id para poder añadir al SIGUIENTE
// envío lo que se recupera tarde (ej. una factura futura de un proveedor que
// no la emite hasta después) sin tener que buscarlo a mano ni repetir lo ya
// mandado -- por eso el filtro es "todo lo sin enviar hasta esta fecha", no
// solo "lo fechado en este rango exacto".
async function movimientosPendientesDeEnvio(hasta) {
  const { rows } = await query(
    `SELECT id, hoja, fila, fecha, concepto, importe, nota_final, proyecto_id, importacion_id, es_devolucion
     FROM movimientos
     WHERE envio_id IS NULL AND estado = 'resuelta' AND (fecha IS NULL OR fecha <= $1)
     ORDER BY fecha NULLS LAST`,
    [hasta]
  );
  return rows;
}

// Facturas del flujo principal (no de lote -- eso sigue con su propio
// trimestre por ahora, "numero" ahí es una secuencia aparte que podría
// coincidir por casualidad, así que se filtra explícitamente y se referencia
// siempre por id, nunca por numero) ya emparejadas con alguno de esos movimientos.
async function facturasDeMovimientos(movimientoIds) {
  if (movimientoIds.length === 0) return [];
  const { rows } = await query(
    `SELECT DISTINCT f.id, f.numero, f.ruta_blob, f.nombre_original
     FROM facturas f JOIN movimiento_facturas mf ON mf.factura_id = f.id
     WHERE mf.movimiento_id = ANY($1::bigint[]) AND f.estado = 'matcheada' AND f.trimestre_id IS NULL
     ORDER BY f.numero`,
    [movimientoIds]
  );
  return rows;
}

// Antes de generar de verdad: qué entraría en el envío si se confirma ahora
// -- para poder revisarlo en pantalla.
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

// Reconstruye el .xlsx final a partir de los excels originales tal cual se
// subieron (uno o varios, según de qué importación viniera cada movimiento
// de este envío) y escribe la nota final de cada línea en su columna de
// siempre — conserva formato y columnas originales, solo rellena lo que faltaba.
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
    // Un único excel subido "suelto" (un solo banco, sin pestañas): el
    // archivo original conserva el nombre de hoja que le puso el banco (ej.
    // "Download (3)" en paypal), no el nombre canónico. Si no se renombra
    // aquí, el bucle de más abajo que busca la hoja por nombre para escribir
    // las notas no la encuentra y esa hoja se queda sin ninguna nota, en
    // silencio, en el excel final. No aplica al export combinado (varias
    // pestañas en un mismo archivo): ahí cada pestaña ya se llama como debe.
    if (!wbFinal.getWorksheet(importaciones[0].hoja)) {
      wbFinal.worksheets[0].name = importaciones[0].hoja;
    }
  } else {
    // Varias importaciones (posiblemente del mismo banco, subidas en momentos
    // distintos): combinarlas copiando valores de celda. Si dos importaciones
    // comparten hoja (ej. dos subidas sueltas de bbva), la segunda se
    // desambigua con un sufijo.
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

  // La columna de nota se calcula igual que al importar (misma función,
  // lib/hojaBanco.cjs) para las hojas en "modo nombres" -- si import y
  // export adivinaran la columna cada uno por su cuenta, podrían acabar en
  // sitios distintos y escribir la nota encima de un dato real del banco.
  await etapa('escribir notas en excel final', async () => {
    for (const imp of importaciones) {
      const ws = wbFinal.getWorksheet(hojaFinalPorImportacion.get(imp.id));
      if (!ws) continue;
      const cfg = sheetsConfig.find(c => c.nombre === imp.hoja);
      const movimientosHoja = movimientos.filter(m => m.importacion_id === imp.id && m.nota_final !== null);
      if (movimientosHoja.length === 0) continue;

      let notaCol;
      if (cfg && cfg.modo === 'nombres') {
        const detectado = detectarHoja(ws, cfg);
        if (!detectado) continue;
        notaCol = detectado.notaCol;
        const celdaCabecera = ws.getRow(detectado.filaCabecera).getCell(notaCol);
        if (!celdaCabecera.value) celdaCabecera.value = 'Nota gestoría';
      } else if (cfg && cfg.notaCol) {
        notaCol = cfg.notaCol;
      } else {
        continue;
      }

      for (const m of movimientosHoja) {
        ws.getRow(m.fila).getCell(notaCol).value = m.nota_final;
      }
    }
  });

  // Pestaña nueva (no viene de ningún banco) con las devoluciones incluidas
  // en este envío -- lo que la usuaria mete a mano en su propia pestaña de
  // devoluciones al preparar la entrega a gestoría. Solo se añade si hay
  // alguna, para no meter una pestaña vacía en envíos sin devoluciones.
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

// Crea el envío de verdad: genera el .zip de entrega (facturas numeradas +
// excel final punteado) PRIMERO, y solo si eso sale bien marca todo lo
// pendiente hasta esa fecha con el envio_id nuevo (movimientos y sus
// facturas emparejadas). En ese orden, si algo falla a mitad (ej. un blob
// que no se puede descargar), nada queda marcado como enviado sin haberse
// entregado de verdad -- se puede reintentar sin perder nada.
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
