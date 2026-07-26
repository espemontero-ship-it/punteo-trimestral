const ExcelJS = require('exceljs');
const { put } = require('@vercel/blob');
const { query } = require('./db.cjs');
const { normalizeKey } = require('./normalize.cjs');
const { cellText, cellNumber, cellDate } = require('./cells.cjs');
const sheetsConfig = require('../config/sheets.json').sheets;

// Importa un excel subido (uno o varias pestañas bbva/openbank/paypal, o una
// sola pestaña "suelta" cuyo origen se indica en `hojaForzada`). Reemplaza los
// movimientos previos de las hojas encontradas para no duplicar en un reintento.
async function importarMovimientos(trimestreId, buffer, nombreArchivo, hojaForzada) {
  await query(`INSERT INTO trimestres (id) VALUES ($1) ON CONFLICT DO NOTHING`, [trimestreId]);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  const hojasEncontradas = [];

  for (const cfg of sheetsConfig) {
    let ws = wb.getWorksheet(cfg.nombre);
    if (!ws && hojaForzada === cfg.nombre && wb.worksheets.length === 1) {
      ws = wb.worksheets[0];
    }
    if (!ws) continue;
    hojasEncontradas.push(cfg.nombre);

    const rutaBlob = await guardarOriginal(trimestreId, cfg.nombre, buffer, nombreArchivo);

    await query('DELETE FROM movimientos WHERE trimestre_id = $1 AND hoja = $2', [trimestreId, cfg.nombre]);
    await query(
      `INSERT INTO excels_originales (trimestre_id, hoja, ruta_blob) VALUES ($1,$2,$3)
       ON CONFLICT (trimestre_id, hoja) DO UPDATE SET ruta_blob = EXCLUDED.ruta_blob`,
      [trimestreId, cfg.nombre, rutaBlob]
    );

    let insertadas = 0;
    for (let r = cfg.dataStartRow; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const texto = cfg.textCols.map(c => cellText(row, c)).filter(Boolean).join(' ');
      if (!texto) continue;
      const importe = cfg.importeCol ? cellNumber(row, cfg.importeCol) : null;
      if (importe === null || importe === 0) continue;
      const fecha = cfg.fechaCol ? cellDate(row, cfg.fechaCol) : null;
      const clave = normalizeKey(texto, importe);

      await query(
        `INSERT INTO movimientos (trimestre_id, hoja, fila, fecha, concepto, importe, clave)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [trimestreId, cfg.nombre, r, fecha ? fecha.toISOString().slice(0, 10) : null, texto, importe, clave]
      );
      insertadas++;
    }
    console.log(`[importarExcel] ${cfg.nombre}: ${insertadas} movimientos importados.`);
  }

  return hojasEncontradas;
}

async function guardarOriginal(trimestreId, hoja, buffer, nombreArchivo) {
  const blob = await put(`excels/${trimestreId}/${hoja}-${Date.now()}.xlsx`, buffer, {
    access: 'public',
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  return blob.url;
}

module.exports = { importarMovimientos };
