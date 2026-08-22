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
// Los movimientos no pertenecen a ningún trimestre: viven en un único
// histórico continuo, identificados solo por su fecha. Cada archivo subido es
// su propia "importación" (tabla `importaciones`), no un singleton por banco
// -- así se puede subir el extracto de un banco muchas veces a lo largo del
// año sin que cada subida reemplace a la anterior. Si una fila ya existía
// (misma fecha+importe+texto, de una subida anterior que se solapa), se
// actualiza su posición y pasa a apuntar a la importación más reciente, para
// que el export final escriba la nota en el archivo correcto.
async function importarMovimientos(buffer, nombreArchivo, hojaForzada) {
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

    // "modo": "nombres" (bbva/openbank/paypal) busca la fila de cabecera real y las
    // columnas por su nombre en vez de asumir una posición fija -- el
    // bloque de metadatos que meten los bancos antes de la tabla no siempre
    // mide lo mismo.
    let dataStartRow, cabeceras, obtenerTexto, obtenerImporte, obtenerFecha;
    // Quién hizo el ingreso, en su columna, aparte del resto del texto.
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
          // Con clave propia y no por el rótulo de la columna: en el export
          // real de BBVA esa columna viene sin rótulo, así que por nombre no
          // se podría volver a encontrar después.
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

// Busca movimientos ya existentes con la misma fecha+importe en TODO el
// histórico de ese banco (no solo en el archivo que se está subiendo) -- así,
// si el extracto se sube con rangos de fechas solapados, una fila que ya se
// punteó antes conserva su estado y su nota en vez de duplicarse. Trae todas
// las filas de ese banco y compara en JS (no por SQL) para no depender de
// reconstruir la clave natural en texto -- con el volumen real (cientos de
// líneas al trimestre) esto sigue siendo instantáneo aunque sea todo el año.
//
// UNA LÍNEA QUE YA ESTÁ NO SE TOCA. Ni sus datos, ni su clave, ni su estado,
// ni la marca de qué jugador de LarpManager le corresponde. Antes se le
// sobrescribían los datos originales con los del archivo nuevo, y esa marca
// vive ahí dentro: cada extracto que se subía borraba el nombre del jugador de
// todas las líneas ya cruzadas (35 en producción el 22/8/2026).
//
// Lo que se pierde a cambio, decidido a sabiendas: el paquete de la gestoría
// escribe sus columnas sobre el excel original, y para eso usa fila e
// importacion_id, que antes se refrescaban aquí. Al no tocarlos, escribirá
// sobre el excel donde esa línea apareció la primera vez, no sobre el último.
async function fusionarHoja(hoja, filasNuevas, importacionId) {
  const { rows: existentes } = await query(
    `SELECT id, fecha, concepto, importe FROM movimientos WHERE hoja = $1 ORDER BY id`,
    [hoja]
  );

  // Se agrupa solo por fecha e importe. El concepto ya no entra en la clave:
  // se compara aparte, con mismaLinea.
  const porFechaImporte = new Map();
  for (const m of existentes) {
    const k = `${m.fecha ? new Date(m.fecha).toISOString().slice(0, 10) : null}|${Number(m.importe).toFixed(2)}`;
    if (!porFechaImporte.has(k)) porFechaImporte.set(k, []);
    porFechaImporte.get(k).push(m);
  }

  // Una línea guardada solo puede ser "la misma" que una fila del archivo: si
  // el banco trae de verdad dos movimientos idénticos el mismo día, siguen
  // siendo dos.
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

// ¿Son la misma línea del banco? El concepto NO lo escribe el banco: lo arma
// esta app pegando varias columnas del excel (ver config/sheets.json). Dos
// exports del mismo banco traen las columnas escritas distinto -- uno con
// BENEFICIARIO/ORDENANTE y otro sin ella, uno en mayúsculas y otro no-- y el
// texto sale más largo o más corto para el MISMO movimiento.
//
// Caso real (16/8/2026): 5 líneas del BBVA entraron por segunda vez porque el
// segundo export les pegó detrás el IBAN y "ticket 2027". Fueron 845 € de
// ingresos contados dos veces.
//
// Por eso se comparan como "una es el principio de la otra" y no por las N
// primeras letras: el 10/7/2026 hay tres transferencias distintas de 90 € cuyo
// concepto no se separa hasta el carácter 53 ("...RECIBIDA EN EUROS Martina
// Ryssel" y "...RECIBIDA EN EUROS Miya Saquet"). Cortando por 40 serían la
// misma. Con esta regla, no: ninguna es el principio de la otra.
//
// El mínimo de 15 caracteres evita que una línea de concepto casi vacío se
// coma a cualquier otra de la misma fecha e importe.
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

// Recalcula la clave de agrupación de todos los movimientos a partir de su
// concepto/importe ya guardados, sin depender de volver a subir el excel --
// para cuando normalizeKey aprende una regla nueva (ej. un proveedor
// conocido) y hay que aplicarla a movimientos ya importados.
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

// Cada archivo subido, con cuántos movimientos tiene y cuántos de esos ya
// están resueltos -- para poder avisar antes de borrar si se va a perder
// trabajo ya hecho (notas, facturas emparejadas), no solo "hay N movimientos".
// Todos los archivos subidos, del banco y de LarpManager. `total` y
// `resueltas` cuentan lo que trajo cada uno: movimientos en las del banco,
// pagos y cuántos ya están emparejados en las de LarpManager.
async function listarImportaciones() {
  // Las columnas que consulta aquí abajo (`importaciones.origen`,
  // `larpmanager_pagos.importacion_id`) las crea esta función, y hasta que no
  // se ha subido un CSV de LarpManager no existen. Sin esta línea, esta
  // pantalla era la única que las leía sin haberlas creado nunca: en
  // producción daba error hasta que se tocaba algo de LarpManager por otro
  // lado. Crearlas antes de preguntar por ellas es lo que ya hacen las demás.
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

// Para cuando se ha subido el archivo equivocado por error: borra los
// movimientos que todavía apuntan a esa importación concreta (los que se
// hayan re-emparejado con una subida más reciente no se tocan) y el registro
// + blob de la importación.
async function borrarImportacion(importacionId) {
  // Igual que en listarImportaciones: `origen` puede no existir todavía.
  await asegurarTablaPagosLarpManager();
  const { rows: existentes } = await query(
    `SELECT ruta_blob, origen FROM importaciones WHERE id = $1`,
    [importacionId]
  );

  // Un CSV de LarpManager trajo pagos, no movimientos del banco: se borran
  // esos pagos y ya. Las líneas del banco NO se tocan -- siguen resueltas y
  // con su nota; solo pierden el enlace con el pago, que es una comprobación,
  // no dinero. Al volver a subir el CSV se recupera solo.
  if (existentes[0]?.origen === 'larpmanager') {
    const { rowCount } = await query(`DELETE FROM larpmanager_pagos WHERE importacion_id = $1`, [importacionId]);
    await query(`DELETE FROM importaciones WHERE id = $1`, [importacionId]);
    try { await eliminarBlob(existentes[0].ruta_blob); } catch { /* si ya no existe, no pasa nada */ }
    console.log(`[borrarImportacion] ${rowCount} pago(s) de LarpManager borrados.`);
    return;
  }
  // Un pago a un colaborador puede estar conciliado contra una de estas
  // líneas, y esa referencia no cede sola: sin esto, borrar el excel fallaba
  // ENTERO con un error de base de datos y sin explicar por qué. Se desvincula
  // primero -- el pago sobrevive, simplemente se queda sin línea de banco, que
  // es el estado en el que nació y desde el que se puede volver a conciliar.
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
    try { await eliminarBlob(rutaBlob); } catch { /* si ya no existe en Blob, no pasa nada */ }
  }
}

module.exports = {
  importarMovimientos, recalcularClaves, listarImportaciones, borrarImportacion };
