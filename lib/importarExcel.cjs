const ExcelJS = require('exceljs');
const { put } = require('@vercel/blob');
const { query } = require('./db.cjs');
const { normalizeKey } = require('./normalize.cjs');
const { cellText, cellNumber, cellDate } = require('./cells.cjs');
const { reintentarPendientes } = require('./facturaMatcher.cjs');
const { detectarHoja } = require('./hojaBanco.cjs');
const { esHtmlDisfrazadoDeExcel, convertirHtmlAWorkbook } = require('./openbankHtml.cjs');
const { eliminarBlob } = require('./blob.cjs');
const { asegurarTablaPagosLarpManager } = require('./larpmanager.cjs');
const sheetsConfig = require('../config/sheets.json').sheets;

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

async function importarMovimientos(buffer, nombreArchivo, hojaForzada) {

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

    let dataStartRow, cabeceras, obtenerTexto, obtenerImporte, obtenerFecha;

    let obtenerOrdenante = () => '';
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
      obtenerOrdenante = row => (detectado.columnas.ordenante ? cellText(row, detectado.columnas.ordenante) : '');
    } else {
      dataStartRow = cfg.dataStartRow;
      cabeceras = leerCabeceras(ws, cfg.dataStartRow);
      obtenerTexto = row => cfg.textCols.map(c => cellText(row, c)).filter(Boolean).join(' ');
      obtenerImporte = row => (cfg.importeCol ? cellNumber(row, cfg.importeCol) : null);
      obtenerFecha = row => (cfg.fechaCol ? cellDate(row, cfg.fechaCol) : null);
    }

    hojasEncontradas.push(cfg.nombre);

    const importacionId = await guardarImportacion(cfg.nombre, bufferReal, nombreArchivo);

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
        datosOriginales: (() => {
          const d = leerDatosOriginales(row, cabeceras);

          const ord = (obtenerOrdenante(row) || '').trim();
          if (ord) d.ordenante = ord;
          return d;
        })(),
      });
    }

    const { actualizadas, insertadas } = await fusionarHoja(cfg.nombre, filasNuevas, importacionId);
    console.log(`[importarExcel] ${cfg.nombre}: ${insertadas} nuevas, ${actualizadas} ya estaban (no se han tocado).`);
  }

  const reintento = await reintentarPendientes();
  if (reintento.revisadas > 0) {
    console.log(`[importarExcel] Reintento de facturas pendientes: ${reintento.resueltas}/${reintento.revisadas} resueltas.`);
  }

  return hojasEncontradas;
}

async function fusionarHoja(hoja, filasNuevas, importacionId) {
  const { rows: existentes } = await query(
    `SELECT id, fecha, concepto, importe FROM movimientos WHERE hoja = $1 ORDER BY id`,
    [hoja]
  );

  const porFechaImporte = new Map();
  for (const m of existentes) {
    const k = `${m.fecha ? new Date(m.fecha).toISOString().slice(0, 10) : null}|${Number(m.importe).toFixed(2)}`;
    if (!porFechaImporte.has(k)) porFechaImporte.set(k, []);
    porFechaImporte.get(k).push(m);
  }

  const yaEmparejadas = new Set();
  let actualizadas = 0, insertadas = 0;

  for (const fila of filasNuevas) {
    const k = `${fila.fecha}|${fila.importe.toFixed(2)}`;
    const grupo = porFechaImporte.get(k) || [];
    const ya = grupo.find(m => !yaEmparejadas.has(m.id) && mismaLinea(m.concepto, fila.concepto));

    if (ya) {
      yaEmparejadas.add(ya.id);
      actualizadas++;
      continue;
    }
    await query(
      `INSERT INTO movimientos (hoja, fila, fecha, concepto, importe, clave, datos_originales, importacion_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [hoja, fila.fila, fila.fecha, fila.concepto, fila.importe, fila.clave, JSON.stringify(fila.datosOriginales), importacionId]
    );
    insertadas++;
  }

  return { actualizadas, insertadas };
}

const MINIMO_PARA_COMPARAR = 15;

function mismaLinea(a, b) {
  const x = normalizarConcepto(a), y = normalizarConcepto(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const corto = x.length <= y.length ? x : y;
  const largo = x.length <= y.length ? y : x;
  return corto.length >= MINIMO_PARA_COMPARAR && largo.startsWith(corto);
}

function normalizarConcepto(texto) {
  return String(texto || '').replace(/\s+/g, ' ').trim().toUpperCase();
}
async function guardarImportacion(hoja, buffer, nombreArchivo) {
  const blob = await put(`excels/${hoja}-${Date.now()}.xlsx`, buffer, {
    access: 'private',
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const { rows } = await query(
    `INSERT INTO importaciones (hoja, ruta_blob, nombre_archivo) VALUES ($1,$2,$3) RETURNING id`,
    [hoja, blob.url, nombreArchivo || null]
  );
  return rows[0].id;
}

async function recalcularClaves() {
  const { rows } = await query(`SELECT id, concepto, importe, clave FROM movimientos`);
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

async function listarImportaciones() {

  await asegurarTablaPagosLarpManager();
  const { rows } = await query(
    `SELECT i.id, i.hoja, i.origen, i.nombre_archivo, i.creado_en,
            CASE WHEN i.origen = 'larpmanager'
                 THEN (SELECT COUNT(*) FROM larpmanager_pagos p WHERE p.importacion_id = i.id)
                 ELSE (SELECT COUNT(*) FROM movimientos m WHERE m.importacion_id = i.id) END AS total,
            CASE WHEN i.origen = 'larpmanager'
                 THEN (SELECT COUNT(*) FROM larpmanager_pagos p WHERE p.importacion_id = i.id AND p.movimiento_id IS NOT NULL)
                 ELSE (SELECT COUNT(*) FROM movimientos m WHERE m.importacion_id = i.id AND m.estado = 'resuelta') END AS resueltas
     FROM importaciones i
     ORDER BY i.creado_en DESC`
  );
  return rows.map(r => ({
    id: r.id, hoja: r.hoja, origen: r.origen, nombreArchivo: r.nombre_archivo, creadoEn: r.creado_en,
    total: Number(r.total), resueltas: Number(r.resueltas),
  }));
}

async function borrarImportacion(importacionId) {

  await asegurarTablaPagosLarpManager();
  const { rows: existentes } = await query(
    `SELECT ruta_blob, origen FROM importaciones WHERE id = $1`,
    [importacionId]
  );

  if (existentes[0]?.origen === 'larpmanager') {
    const { rowCount } = await query(`DELETE FROM larpmanager_pagos WHERE importacion_id = $1`, [importacionId]);
    await query(`DELETE FROM importaciones WHERE id = $1`, [importacionId]);
    try { await eliminarBlob(existentes[0].ruta_blob); } catch {  }
    console.log(`[borrarImportacion] ${rowCount} pago(s) de LarpManager borrados.`);
    return;
  }

  const { rows: desvinculados } = await query(
    `UPDATE pagos SET movimiento_id = NULL
     WHERE movimiento_id IN (SELECT id FROM movimientos WHERE importacion_id = $1)
     RETURNING id`,
    [importacionId]
  );
  if (desvinculados.length > 0) {
    console.log(`[borrarImportacion] ${desvinculados.length} pago(s) de colaborador desvinculados de sus líneas.`);
  }

  await query(`DELETE FROM movimientos WHERE importacion_id = $1`, [importacionId]);
  await query(`DELETE FROM importaciones WHERE id = $1`, [importacionId]);
  for (const { ruta_blob: rutaBlob } of existentes) {
    try { await eliminarBlob(rutaBlob); } catch {  }
  }
}

module.exports = {
  importarMovimientos, recalcularClaves, listarImportaciones, borrarImportacion };
