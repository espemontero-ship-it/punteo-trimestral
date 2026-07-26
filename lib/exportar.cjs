const ExcelJS = require('exceljs');
const archiver = require('archiver');
const { query } = require('./db.cjs');
const { descargarBlob } = require('./blob.cjs');
const sheetsConfig = require('../config/sheets.json').sheets;

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
    const buf = await descargarBlob(ruta);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    workbooksPorRuta.set(ruta, wb);
  }

  let wbFinal;
  if (rutasDistintas.length === 1) {
    wbFinal = workbooksPorRuta.get(rutasDistintas[0]);
  } else {
    // Varias fuentes subidas por separado: combinarlas copiando valores de celda.
    wbFinal = new ExcelJS.Workbook();
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
  }

  for (const cfg of sheetsConfig) {
    if (!cfg.notaCol) continue;
    const ws = wbFinal.getWorksheet(cfg.nombre);
    if (!ws) continue;
    for (const m of movimientos.filter(m => m.hoja === cfg.nombre)) {
      ws.getRow(m.fila).getCell(cfg.notaCol).value = m.nota_final;
    }
  }

  return wbFinal.xlsx.writeBuffer();
}

// Genera el .zip de entrega: facturas numeradas (descargadas de Blob) + el
// .xlsx final punteado.
async function generarPaqueteTrimestre(trimestreId) {
  const { rows: facturas } = await query(
    `SELECT numero, ruta_blob, nombre_original FROM facturas
     WHERE trimestre_id = $1 AND estado = 'matcheada' ORDER BY numero`,
    [trimestreId]
  );

  const excelBuffer = await generarExcelFinal(trimestreId);

  const archive = archiver('zip', { zlib: { level: 9 } });
  const chunks = [];
  archive.on('data', c => chunks.push(c));
  const listo = new Promise((resolve, reject) => {
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', reject);
  });

  archive.append(excelBuffer, { name: `punteo-${trimestreId}.xlsx` });
  for (const f of facturas) {
    const ext = (f.nombre_original || '').split('.').pop() || 'pdf';
    const buf = await descargarBlob(f.ruta_blob);
    archive.append(buf, { name: `facturas/${f.numero}.${ext}` });
  }
  archive.finalize();

  return listo;
}

module.exports = { generarExcelFinal, generarPaqueteTrimestre };
