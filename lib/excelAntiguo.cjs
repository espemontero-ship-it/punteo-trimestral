const XLSX = require('xlsx');

function esExcelAntiguo(buffer) {
  return buffer.length > 4 && buffer[0] === 0xD0 && buffer[1] === 0xCF && buffer[2] === 0x11 && buffer[3] === 0xE0;
}

function convertirExcelAntiguo(buffer) {
  try {
    const libro = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    if (!libro.SheetNames.some(n => libro.Sheets[n] && libro.Sheets[n]['!ref'])) throw new Error('El archivo no tiene datos.');
    return XLSX.write(libro, { type: 'buffer', bookType: 'xlsx' });
  } catch (err) {
    const e = new Error('No se ha podido abrir el archivo .xls (¿tiene contraseña o está dañado?). Ábrelo en Excel, guárdalo como .xlsx y súbelo de nuevo.');
    e.cause = err;
    throw e;
  }
}

module.exports = { esExcelAntiguo, convertirExcelAntiguo };
