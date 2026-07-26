const ExcelJS = require('exceljs');
const { leerCarpetaFacturas } = require('./lib/facturas.cjs');
const { aplicarMatching, escribirResumenFacturas } = require('./lib/matchearCore.cjs');

async function main() {
  const bancoPath = process.argv[2];
  const carpetaFacturas = process.argv[3];
  const salidaPath = process.argv[4];

  if (!bancoPath || !carpetaFacturas || !salidaPath) {
    console.error('Uso: node matchear.js <banco.xlsx> <carpeta_facturas> <salida.xlsx>');
    process.exit(1);
  }

  console.log('Leyendo facturas de:', carpetaFacturas);
  const facturas = await leerCarpetaFacturas(carpetaFacturas);
  const numerosFactura = Object.keys(facturas);
  console.log(`  ${numerosFactura.length} archivos encontrados (${numerosFactura.filter(n => facturas[n].esImagen).length} son imágenes, sin texto legible).`);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(bancoPath);

  const resultado = aplicarMatching(wb, facturas);
  escribirResumenFacturas(wb, resultado);

  await wb.xlsx.writeFile(salidaPath);

  console.log('\nResumen:');
  for (const r of resultado.resumen) {
    console.log(`  ${r.hoja}: ${r.conCandidata} con candidata (${r.combinadas} combinadas), ${r.sinCandidata} sin factura en carpeta, ${r.discrepancias} discrepancias con la nota actual`);
  }
  console.log(`  Facturas huérfanas (en la carpeta, sin movimiento que las use): ${resultado.huerfanas.length}`);
  console.log(`  Imágenes sin texto legible: ${resultado.imagenes.length}`);
  console.log(`\nGuardado en: ${salidaPath}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
