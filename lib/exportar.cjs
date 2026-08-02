const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const { query } = require('./db.cjs');
const { descargarBlob } = require('./blob.cjs');
const { detectarHoja } = require('./hojaBanco.cjs');
const { listarDevolucionesTrimestre } = require('./devoluciones.cjs');
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

// Reconstruye el .xlsx final: descarga el/los excel(s) originales tal cual se
// subieron y escribe la nota final de cada línea en su columna de siempre —
// conserva formato y columnas originales, solo rellena lo que faltaba.
async function generarExcelFinal(trimestreId) {
  const { rows: originales } = await query(
    'SELECT hoja, ruta_blob FROM excels_originales WHERE trimestre_id = $1',
    [trimestreId]
  );
  if (originales.length === 0) throw new Error('No hay ningún excel subido para este trimestre.');

  const { rows: movimientos } = await query(
    `SELECT hoja, fila, nota_final FROM movimientos WHERE trimestre_id = $1 AND nota_final IS NOT NULL`,
    [trimestreId]
  );

  const rutasDistintas = [...new Set(originales.map(o => o.ruta_blob))];
  const workbooksPorRuta = new Map();
  for (const ruta of rutasDistintas) {
    const buf = await etapa(`descargar excel original ${ruta}`, () => descargarBlob(ruta));
    const wb = new ExcelJS.Workbook();
    await etapa(`cargar excel original ${ruta}`, () => wb.xlsx.load(buf));
    workbooksPorRuta.set(ruta, wb);
  }

  let wbFinal;
  if (rutasDistintas.length === 1) {
    wbFinal = workbooksPorRuta.get(rutasDistintas[0]);
    // Una única hoja, subida "suelta" (un solo banco, sin pestañas): el
    // archivo original conserva el nombre de hoja que le puso el banco (ej.
    // "Download (3)" en paypal), no el nombre canonico (o.hoja). Si no se
    // renombra aqui, el bucle de mas abajo que busca la hoja por nombre para
    // escribir las notas no la encuentra y esa hoja se queda sin ninguna nota,
    // en silencio, en el excel final. No aplica al export combinado (varias
    // pestanas en un mismo archivo): ahi cada pestana ya se llama como debe.
    if (originales.length === 1 && !wbFinal.getWorksheet(originales[0].hoja)) {
      wbFinal.worksheets[0].name = originales[0].hoja;
    }
  } else {
    // Varias fuentes subidas por separado: combinarlas copiando valores de celda.
    wbFinal = new ExcelJS.Workbook();
    await etapa('combinar excels originales', async () => {
      for (const o of originales) {
        const wbOrigen = workbooksPorRuta.get(o.ruta_blob);
        const wsOrigen = wbOrigen.getWorksheet(o.hoja) || wbOrigen.worksheets[0];
        const wsNueva = wbFinal.addWorksheet(o.hoja);
        wsOrigen.eachRow({ includeEmpty: true }, (row, rn) => {
          const nueva = wsNueva.getRow(rn);
          row.eachCell({ includeEmpty: true }, (cell, cn) => { nueva.getCell(cn).value = cell.value; });
          nueva.commit();
        });
      }
    });
  }

  // La columna de nota se calcula igual que al importar (misma función,
  // lib/hojaBanco.cjs) para las hojas en "modo nombres" -- si import y
  // export adivinaran la columna cada uno por su cuenta, podrían acabar en
  // sitios distintos y escribir la nota encima de un dato real del banco.
  await etapa('escribir notas en excel final', async () => {
    for (const cfg of sheetsConfig) {
      const ws = wbFinal.getWorksheet(cfg.nombre);
      if (!ws) continue;
      const movimientosHoja = movimientos.filter(m => m.hoja === cfg.nombre);
      if (movimientosHoja.length === 0) continue;

      let notaCol;
      if (cfg.modo === 'nombres') {
        const detectado = detectarHoja(ws, cfg);
        if (!detectado) continue;
        notaCol = detectado.notaCol;
        const celdaCabecera = ws.getRow(detectado.filaCabecera).getCell(notaCol);
        if (!celdaCabecera.value) celdaCabecera.value = 'Nota gestoría';
      } else {
        if (!cfg.notaCol) continue;
        notaCol = cfg.notaCol;
      }

      for (const m of movimientosHoja) {
        ws.getRow(m.fila).getCell(notaCol).value = m.nota_final;
      }
    }
  });

  // Pestaña nueva (no viene de ningún banco) con las devoluciones del
  // trimestre -- lo que la usuaria mete a mano en su propia pestaña de
  // devoluciones al preparar la entrega a gestoría. Solo se añade si hay
  // alguna, para no meter una pestaña vacía en trimestres sin devoluciones.
  await etapa('escribir pestaña de devoluciones', async () => {
    const devoluciones = await listarDevolucionesTrimestre(trimestreId);
    if (devoluciones.length === 0) return;
    const ws = wbFinal.addWorksheet('Devoluciones');
    ws.addRow(['Fecha', 'Importe', 'Proyecto', 'Jugador (LarpManager)', 'Nota']);
    for (const d of devoluciones) {
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

// Genera el .zip de entrega: facturas numeradas (descargadas de Blob) + el
// .xlsx final punteado.
async function generarPaqueteTrimestre(trimestreId) {
  // Facturas de proveedor ya matcheadas + facturas de lote (colaboradores)
  // aceptadas en revisión. Las de lote rechazadas (ej. tickets no válidos)
  // se quedan fuera a propósito.
  const { rows: facturas } = await query(
    `SELECT numero, ruta_blob, nombre_original FROM facturas
     WHERE trimestre_id = $1 AND (estado = 'matcheada' OR estado_revision = 'aceptada')
     ORDER BY numero`,
    [trimestreId]
  );

  const excelBuffer = await generarExcelFinal(trimestreId);

  const zip = new JSZip();
  zip.file(`punteo-${trimestreId}.xlsx`, excelBuffer);
  for (const f of facturas) {
    const ext = (f.nombre_original || '').split('.').pop() || 'pdf';
    await etapa(`añadir factura ${f.numero} (${f.nombre_original || 'sin nombre'}) al zip`, async () => {
      const buf = await descargarBlob(f.ruta_blob);
      zip.file(`facturas/${f.numero}.${ext}`, buf);
    });
  }

  return etapa('generar el zip', () => zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
}

module.exports = { generarExcelFinal, generarPaqueteTrimestre };
