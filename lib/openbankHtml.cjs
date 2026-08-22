const cheerio = require('cheerio');
const ExcelJS = require('exceljs');

// Openbank exporta los movimientos de cuenta como una tabla HTML con
// extensión .xls (Excel la abre igual, pero no es un xlsx de verdad —
// ExcelJS no puede leerlo, falla con "is this a zip file?"). Se detecta
// mirando el principio del archivo en vez de solo la extensión, porque la
// extensión miente.
function esHtmlDisfrazadoDeExcel(buffer) {
  const inicio = buffer.subarray(0, 500).toString('latin1').toUpperCase();
  return inicio.includes('<!DOCTYPE HTML') || inicio.includes('<HTML');
}

// Un solo lector de importes en toda la app (lib/numero.cjs). Aquí había otro
// distinto que quitaba TODOS los puntos y cambiaba la primera coma: con un
// número a la española ("2.013,88") daba lo mismo, pero con uno a la
// internacional ("1,234.56") devolvía 1,23. Tres lectores con reglas
// distintas para lo mismo es una forma de que dos pantallas no coincidan.
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

// La tabla real trae metadatos de la cuenta (titular, saldo...) mezclados en
// las mismas filas que la tabla de movimientos, así que no vale con "todo lo
// que va después de la cabecera" -- cada fila de movimiento real tiene
// exactamente 5 celdas con contenido y la primera es una fecha DD/MM/AAAA;
// eso es lo que se comprueba fila a fila, en vez de fiarse de la posición.
function extraerFilasReales($) {
  const filas = [];
  $('table').first().find('tr').each((i, tr) => {
    const celdas = $(tr).find('td').map((j, td) => $(td).text().trim()).get().filter(t => t !== '');
    if (celdas.length !== 5) return;
    const fecha = parseFechaEs(celdas[1]); // Fecha Valor
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

// Convierte el HTML en un Workbook de ExcelJS de verdad, con las mismas
// cabeceras que espera config/sheets.json para "openbank" -- así el resto
// del pipeline (detección de columnas, fusión, export final) no necesita
// saber que el original no era un xlsx.
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
