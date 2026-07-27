const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');
const { aplicarClasificacion, escribirResumenClasificacion } = require('./lib/clasificarCore.cjs');

async function main() {
  const inputPath = process.argv[2];
  const outputPath = process.argv[3];
  const memoriaPath = process.argv[4] || path.join(__dirname, 'memoria_proveedores.json');

  if (!inputPath || !outputPath) {
    console.error('Uso: node clasificar.js <excel_trimestre_nuevo.xlsx> <excel_salida.xlsx> [memoria_proveedores.json]');
    process.exit(1);
  }

  const memoria = fs.existsSync(memoriaPath) ? JSON.parse(fs.readFileSync(memoriaPath, 'utf8')) : {};

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(inputPath);

  const resumen = aplicarClasificacion(wb, memoria);
  escribirResumenClasificacion(wb, resumen);

  await wb.xlsx.writeFile(outputPath);

  console.log('Resumen:');
  for (const r of resumen) {
    console.log(`  ${r.hoja}: ${r.nuevas} nuevas, ${r.fijas} con sugerencia fija, ${r.mixtas} mixtas/revisar`);
  }
  console.log(`\nGuardado en: ${outputPath}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
