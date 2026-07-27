const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');
const { leerCarpetaFacturas } = require('./lib/facturas.cjs');
const { aplicarClasificacion, escribirResumenClasificacion } = require('./lib/clasificarCore.cjs');
const { aplicarMatching, escribirResumenFacturas } = require('./lib/matchearCore.cjs');

async function main() {
  const bancoPath = process.argv[2];
  const carpetaFacturas = process.argv[3];
  const salidaPath = process.argv[4];
  const memoriaPath = process.argv[5] || path.join(__dirname, 'memoria_proveedores.json');

  if (!bancoPath || !carpetaFacturas || !salidaPath) {
    console.error('Uso: node puntear.js <banco.xlsx> <carpeta_facturas> <salida.xlsx> [memoria_proveedores.json]');
    process.exit(1);
  }

  const memoria = fs.existsSync(memoriaPath) ? JSON.parse(fs.readFileSync(memoriaPath, 'utf8')) : {};

  console.log('Leyendo facturas de:', carpetaFacturas);
  const facturas = await leerCarpetaFacturas(carpetaFacturas);
  const numerosFactura = Object.keys(facturas);
  console.log(`  ${numerosFactura.length} archivos encontrados (${numerosFactura.filter(n => facturas[n].esImagen).length} son imágenes, sin texto legible).\n`);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(bancoPath);

  console.log('Clasificando por proveedor conocido...');
  const resumenClasificacion = aplicarClasificacion(wb, memoria);
  escribirResumenClasificacion(wb, resumenClasificacion);
  for (const r of resumenClasificacion) {
    console.log(`  ${r.hoja}: ${r.nuevas} nuevas, ${r.fijas} fijas, ${r.mixtas} mixtas`);
  }

  console.log('\nCruzando contra las facturas de la carpeta...');
  const resultadoMatching = aplicarMatching(wb, facturas);
  escribirResumenFacturas(wb, resultadoMatching);
  for (const r of resultadoMatching.resumen) {
    console.log(`  ${r.hoja}: ${r.conCandidata} con candidata (${r.combinadas} combinadas), ${r.sinCandidata} sin factura, ${r.discrepancias} discrepancias`);
  }
  console.log(`  Facturas huérfanas: ${resultadoMatching.huerfanas.length} | Imágenes sin leer: ${resultadoMatching.imagenes.length}`);

  await wb.xlsx.writeFile(salidaPath);
  console.log(`\nGuardado en: ${salidaPath}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
