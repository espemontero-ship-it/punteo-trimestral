const cheerio = require('cheerio');
const ExcelJS = require('exceljs');

function esHtmlDisfrazadoDeExcel(buffer) {
  const inicio = buffer.subarray(0, 500).toString('latin1').toUpperCase();
  return inicio.includes('<!DOCTYPE HTML') || inicio.includes('<HTML');
}

const { parseImporte } = require('./numero.cjs');

function parseImporteEs(texto) {
  const n = parseImporte(texto);
  return isNaN(n) ? null : n;
}

function parseFechaEs(texto) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((texto || '').trim());
  if (!m) return null;
  const [, dia, mes, anio] = m;
  const fecha = new Date(`${anio}-${mes}-${dia}`);
  return isNaN(fecha.getTime()) ? null : fecha;
}

function extraerFilasReales($) {
  const filas = [];
  $('table').first().find('tr').each((i, tr) => {
    const celdas = $(tr).find('td').map((j, td) => $(td).text().trim()).get().filter(t => t !== '');
    if (celdas.length !== 5) return;
    const fecha = parseFechaEs(celdas[1]);
    if (!fecha) return;
    filas.push({
      fechaOperacion: celdas[0],
      fechaValor: fecha,
      concepto: celdas[2],
      importe: parseImporteEs(celdas[3]),
      saldo: parseImporteEs(celdas[4]),
    });
  });
  return filas;
}

function convertirHtmlAWorkbook(buffer, nombreHoja = 'openbank') {
  const html = buffer.toString('latin1');
  const $ = cheerio.load(html);
  const filas = extraerFilasReales($);
  if (filas.length === 0) {
    throw new Error('No se ha encontrado ninguna fila de movimientos en el archivo de Openbank.');
  }

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(nombreHoja);
  ws.addRow(['Fecha Operación', 'Fecha Valor', 'Concepto', 'Importe', 'Saldo']);
  for (const f of filas) {
    ws.addRow([f.fechaOperacion, f.fechaValor, f.concepto, f.importe, f.saldo]);
  }
  return wb;
}

module.exports = { esHtmlDisfrazadoDeExcel, convertirHtmlAWorkbook };
