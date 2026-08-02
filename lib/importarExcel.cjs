const ExcelJS = require('exceljs');
const { put } = require('@vercel/blob');
const { query } = require('./db.cjs');
const { normalizeKey } = require('./normalize.cjs');
const { cellText, cellNumber, cellDate } = require('./cells.cjs');
const { reintentarPendientes } = require('./facturaMatcher.cjs');
const { detectarHoja } = require('./hojaBanco.cjs');
const { esHtmlDisfrazadoDeExcel, convertirHtmlAWorkbook } = require('./openbankHtml.cjs');
const { eliminarBlob } = require('./blob.cjs');
const sheetsConfig = require('../config/sheets.json').sheets;

// Lee los nombres de columna de la fila de cabecera (la fila justo antes de
// donde empiezan los datos), para poder guardar cada fila completa sin tener
// que saber de antemano qué columnas tiene cada banco.
function leerCabeceras(ws, dataStartRow) {
  const headerRow = dataStartRow - 1;
  if (headerRow < 1) return [];
  const row = ws.getRow(headerRow);
  const cabeceras = [];
  const totalCols = Math.max(ws.columnCount || 0, row.cellCount || 0);
  for (let c = 1; c <= totalCols; c++) {
    const nombre = cellText(row, c);
    if (nombre) cabeceras.push({ col: c, nombre });
  }
  return cabeceras;
}

// Guarda el valor de cada columna con cabecera conocida, tal cual está en esa
// fila del excel — para poder mostrarla/ocultarla en pantalla sin perder nada.
function leerDatosOriginales(row, cabeceras) {
  const datos = {};
  for (const { col, nombre } of cabeceras) {
    const cell = row.getCell(col);
    let valor = cell.value;
    if (valor instanceof Date) valor = valor.toISOString().slice(0, 10);
    else if (valor && typeof valor === 'object' && valor.richText) valor = cellText(row, col);
    if (valor !== null && valor !== undefined && valor !== '') datos[nombre] = valor;
  }
  return datos;
}

// Importa un excel subido (uno o varias pestañas bbva/openbank/paypal, o una
// sola pestaña "suelta" cuyo origen se indica en `hojaForzada`).
//
// Pensado para subirse varias veces a lo largo del trimestre (el extracto del
// banco crece con el tiempo): FUSIONA en vez de reemplazar — un movimiento ya
// visto antes (misma fecha + importe + concepto) conserva su estado y su nota,
// solo se actualiza su posición de fila. Los movimientos nuevos se añaden.
async function importarMovimientos(trimestreId, buffer, nombreArchivo, hojaForzada) {
  await query(`INSERT INTO trimestres (id) VALUES ($1) ON CONFLICT DO NOTHING`, [trimestreId]);

  // Openbank exporta los movimientos como una tabla HTML con extensión .xls
  // -- no es un xlsx de verdad, ExcelJS no puede leerlo. Se convierte antes
  // a un workbook real, y ESE es el que se guarda como "original" (para que
  // el export final de fin de trimestre también pueda releerlo).
  let bufferReal = buffer;
  const wb = new ExcelJS.Workbook();
  if (esHtmlDisfrazadoDeExcel(buffer)) {
    const wbConvertido = convertirHtmlAWorkbook(buffer, hojaForzada || 'openbank');
    bufferReal = await wbConvertido.xlsx.writeBuffer();
    await wb.xlsx.load(bufferReal);
  } else {
    await wb.xlsx.load(buffer);
  }

  const hojasEncontradas = [];

  for (const cfg of sheetsConfig) {
    let ws = wb.getWorksheet(cfg.nombre);
    if (!ws && hojaForzada === cfg.nombre && wb.worksheets.length === 1) {
      ws = wb.worksheets[0];
    }
    if (!ws) continue;

    // "modo": "nombres" (bbva/openbank) busca la fila de cabecera real y las
    // columnas por su nombre en vez de asumir una posición fija -- el
    // bloque de metadatos que meten los bancos antes de la tabla no siempre
    // mide lo mismo. paypal se queda con el modo antiguo (posición fija),
    // que ya funciona bien y no hay motivo para tocar.
    let dataStartRow, cabeceras, obtenerTexto, obtenerImporte, obtenerFecha;
    if (cfg.modo === 'nombres') {
      const detectado = detectarHoja(ws, cfg);
      if (!detectado || detectado.columnas.importe === null) {
        console.log(`[importarExcel] ${cfg.nombre}: no se ha reconocido la cabecera esperada (${cfg.cabeceraContiene.join(', ')}), se ignora esta hoja.`);
        continue;
      }
      dataStartRow = detectado.dataStartRow;
      cabeceras = detectado.cabecera.filter(c => c.nombre);
      obtenerTexto = row => detectado.columnas.texto.map(c => cellText(row, c)).filter(Boolean).join(' ');
      obtenerImporte = row => cellNumber(row, detectado.columnas.importe);
      obtenerFecha = row => (detectado.columnas.fecha ? cellDate(row, detectado.columnas.fecha) : null);
    } else {
      dataStartRow = cfg.dataStartRow;
      cabeceras = leerCabeceras(ws, cfg.dataStartRow);
      obtenerTexto = row => cfg.textCols.map(c => cellText(row, c)).filter(Boolean).join(' ');
      obtenerImporte = row => (cfg.importeCol ? cellNumber(row, cfg.importeCol) : null);
      obtenerFecha = row => (cfg.fechaCol ? cellDate(row, cfg.fechaCol) : null);
    }

    hojasEncontradas.push(cfg.nombre);

    const rutaBlob = await guardarOriginal(trimestreId, cfg.nombre, bufferReal, nombreArchivo);
    await query(
      `INSERT INTO excels_originales (trimestre_id, hoja, ruta_blob) VALUES ($1,$2,$3)
       ON CONFLICT (trimestre_id, hoja) DO UPDATE SET ruta_blob = EXCLUDED.ruta_blob`,
      [trimestreId, cfg.nombre, rutaBlob]
    );

    const filasNuevas = [];
    for (let r = dataStartRow; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const texto = obtenerTexto(row);
      if (!texto) continue;
      const importe = obtenerImporte(row);
      if (importe === null || importe === 0) continue;
      const fecha = obtenerFecha(row);
      const clave = normalizeKey(texto, importe);
      const fechaIso = fecha ? fecha.toISOString().slice(0, 10) : null;
      filasNuevas.push({
        fila: r, fecha: fechaIso, concepto: texto.trim(), importe, clave,
        claveNatural: `${fechaIso}|${importe.toFixed(2)}|${texto.trim()}`,
        datosOriginales: leerDatosOriginales(row, cabeceras),
      });
    }

    const { actualizadas, insertadas } = await fusionarHoja(trimestreId, cfg.nombre, filasNuevas);
    console.log(`[importarExcel] ${cfg.nombre}: ${insertadas} nuevas, ${actualizadas} ya existían (fila actualizada, notas conservadas).`);
  }

  const reintento = await reintentarPendientes(trimestreId);
  if (reintento.revisadas > 0) {
    console.log(`[importarExcel] Reintento de facturas pendientes: ${reintento.resueltas}/${reintento.revisadas} resueltas.`);
  }

  return hojasEncontradas;
}

async function fusionarHoja(trimestreId, hoja, filasNuevas) {
  const { rows: existentes } = await query(
    `SELECT id, fecha, concepto, importe, clave FROM movimientos
     WHERE trimestre_id = $1 AND hoja = $2 ORDER BY id`,
    [trimestreId, hoja]
  );

  const gruposExistentes = new Map();
  for (const m of existentes) {
    const k = `${m.fecha ? new Date(m.fecha).toISOString().slice(0, 10) : null}|${Number(m.importe).toFixed(2)}|${m.concepto}`;
    if (!gruposExistentes.has(k)) gruposExistentes.set(k, []);
    gruposExistentes.get(k).push(m);
  }

  const usados = new Map(); // claveNatural -> cuántos ya emparejados
  let actualizadas = 0, insertadas = 0;

  for (const fila of filasNuevas) {
    const grupo = gruposExistentes.get(fila.claveNatural) || [];
    const idx = usados.get(fila.claveNatural) || 0;

    if (idx < grupo.length) {
      // Ya existía: conserva estado/nota, solo actualiza posición, clave (por si el
      // normalizador cambió) y los datos originales, para que el export final escriba
      // en la fila correcta y la pantalla tenga siempre la última versión de la fila.
      await query(
        `UPDATE movimientos SET fila = $1, clave = $2, datos_originales = $3 WHERE id = $4`,
        [fila.fila, fila.clave, JSON.stringify(fila.datosOriginales), grupo[idx].id]
      );
      actualizadas++;
    } else {
      await query(
        `INSERT INTO movimientos (trimestre_id, hoja, fila, fecha, concepto, importe, clave, datos_originales)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [trimestreId, hoja, fila.fila, fila.fecha, fila.concepto, fila.importe, fila.clave, JSON.stringify(fila.datosOriginales)]
      );
      insertadas++;
    }
    usados.set(fila.claveNatural, idx + 1);
  }

  return { actualizadas, insertadas };
}

async function guardarOriginal(trimestreId, hoja, buffer, nombreArchivo) {
  const blob = await put(`excels/${trimestreId}/${hoja}-${Date.now()}.xlsx`, buffer, {
    access: 'private',
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  return blob.url;
}

// Recalcula la clave de agrupación de todos los movimientos de un trimestre
// a partir de su concepto/importe ya guardados, sin depender de volver a
// subir el excel — para cuando normalizeKey aprende una regla nueva (ej. un
// proveedor conocido) y hay que aplicarla a movimientos ya importados.
async function recalcularClaves(trimestreId) {
  const { rows } = await query(
    `SELECT id, concepto, importe, clave FROM movimientos WHERE trimestre_id = $1`,
    [trimestreId]
  );
  let cambiadas = 0;
  for (const m of rows) {
    const nueva = normalizeKey(m.concepto, m.importe);
    if (nueva !== m.clave) {
      await query(`UPDATE movimientos SET clave = $1 WHERE id = $2`, [nueva, m.id]);
      cambiadas++;
    }
  }
  return { revisadas: rows.length, cambiadas };
}

// Qué excels hay subidos para un trimestre, con cuántos movimientos tiene
// cada uno y cuántos de esos ya están resueltos -- para poder avisar antes
// de borrar si se va a perder trabajo ya hecho (notas, facturas emparejadas),
// no solo "hay N movimientos".
async function listarHojas(trimestreId) {
  const { rows } = await query(
    `SELECT e.hoja,
            COUNT(m.id) AS total,
            COUNT(m.id) FILTER (WHERE m.estado = 'resuelta') AS resueltas
     FROM excels_originales e
     LEFT JOIN movimientos m ON m.trimestre_id = e.trimestre_id AND m.hoja = e.hoja
     WHERE e.trimestre_id = $1
     GROUP BY e.hoja
     ORDER BY e.hoja`,
    [trimestreId]
  );
  return rows.map(r => ({ hoja: r.hoja, total: Number(r.total), resueltas: Number(r.resueltas) }));
}

// Para cuando se ha subido el archivo equivocado por error (ej. el excel de
// otra cuenta/banco): borra todos los movimientos de esa hoja en este
// trimestre y el registro + blob del excel original, para poder subir el
// correcto desde cero sin que se mezclen con los malos.
async function borrarHoja(trimestreId, hoja) {
  const { rows: existentes } = await query(
    `SELECT ruta_blob FROM excels_originales WHERE trimestre_id = $1 AND hoja = $2`,
    [trimestreId, hoja]
  );
  await query(`DELETE FROM movimientos WHERE trimestre_id = $1 AND hoja = $2`, [trimestreId, hoja]);
  await query(`DELETE FROM excels_originales WHERE trimestre_id = $1 AND hoja = $2`, [trimestreId, hoja]);
  for (const { ruta_blob: rutaBlob } of existentes) {
    try { await eliminarBlob(rutaBlob); } catch { /* si ya no existe en Blob, no pasa nada */ }
  }
}

module.exports = { importarMovimientos, recalcularClaves, listarHojas, borrarHoja };
