const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');
const { normalizeKey } = require('./lib/normalize.cjs');
const { cellText, cellNumber } = require('./lib/cells.cjs');
const sheetsConfig = require('./config/sheets.json').sheets;

async function main() {
  const inputPath = process.argv[2];
  const memoriaPath = process.argv[3] || path.join(__dirname, 'memoria_proveedores.json');

  if (!inputPath) {
    console.error('Uso: node aprender.js <excel_trimestre_completado.xlsx> [memoria_proveedores.json]');
    process.exit(1);
  }

  let memoria = {};
  if (fs.existsSync(memoriaPath)) {
    memoria = JSON.parse(fs.readFileSync(memoriaPath, 'utf8'));
  }

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(inputPath);

  for (const cfg of sheetsConfig) {
    const ws = wb.getWorksheet(cfg.nombre);
    if (!ws) continue;
    if (!cfg.notaCol) continue;

    memoria[cfg.nombre] = memoria[cfg.nombre] || {};
    let aprendidas = 0;

    for (let r = cfg.dataStartRow; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const nota = cellText(row, cfg.notaCol);
      if (!nota) continue;

      const texto = cfg.textCols.map(c => cellText(row, c)).filter(Boolean).join(' ');
      const importe = cfg.importeCol ? cellNumber(row, cfg.importeCol) : null;
      const key = normalizeKey(texto, importe);
      if (!key) continue;

      memoria[cfg.nombre][key] = memoria[cfg.nombre][key] || { total: 0, notas: {} };
      memoria[cfg.nombre][key].total += 1;
      memoria[cfg.nombre][key].notas[nota] = (memoria[cfg.nombre][key].notas[nota] || 0) + 1;
      aprendidas++;
    }
    console.log(`${cfg.nombre}: ${aprendidas} líneas con nota aprendidas (${Object.keys(memoria[cfg.nombre]).length} claves distintas en memoria).`);
  }

  fs.writeFileSync(memoriaPath, JSON.stringify(memoria, null, 2), 'utf8');
  console.log(`\nMemoria guardada en: ${memoriaPath}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
