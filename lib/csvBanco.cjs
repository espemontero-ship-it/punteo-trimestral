const XLSX = require('xlsx');

function esCsv(nombreArchivo) {
  return /\.csv$/i.test(nombreArchivo || '');
}

function separadorDe(texto) {
  const primera = texto.split(/\r?\n/, 1)[0];
  const cuentas = [',', ';', '\t'].map(s => [s, primera.split(s).length - 1]);
  cuentas.sort((a, b) => b[1] - a[1]);
  return cuentas[0][0];
}

function convertirCsv(buffer) {
  try {
    const texto = buffer.toString('utf8').replace(/^﻿/, '');
    const libro = XLSX.read(texto, { type: 'string', raw: true, FS: separadorDe(texto) });
    const filas = XLSX.utils.sheet_to_json(libro.Sheets[libro.SheetNames[0]], { header: 1, blankrows: false });
    if (!filas.some(f => f.some(c => String(c ?? '').trim() !== ''))) throw new Error('El archivo no tiene datos.');
    return XLSX.write(libro, { type: 'buffer', bookType: 'xlsx' });
  } catch (err) {
    const e = new Error('No se ha podido leer el archivo CSV. Comprueba que es el export del banco, sin tocar, y súbelo de nuevo.');
    e.cause = err;
    throw e;
  }
}

module.exports = { esCsv, convertirCsv };
