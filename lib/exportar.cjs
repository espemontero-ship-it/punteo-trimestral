const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const { query } = require('./db.cjs');
const { descargarBlob } = require('./blob.cjs');
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

  await etapa('escribir notas en excel final', async () => {
    for (const cfg of sheetsConfig) {
      if (!cfg.notaCol) continue;
      const ws = wbFinal.getWorksheet(cfg.nombre);
      if (!ws) continue;
      for (const m of movimientos.filter(m => m.hoja === cfg.nombre)) {
        ws.getRow(m.fila).getCell(cfg.notaCol).value = m.nota_final;
      }
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
