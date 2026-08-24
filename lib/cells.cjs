function cellText(row, col) {
  const cell = row.getCell(col);
  if (cell.value === null || cell.value === undefined) return '';
  if (typeof cell.value === 'object' && cell.value.richText) {
    return cell.value.richText.map(t => t.text).join('');
  }
  return String(cell.value).trim();
}

function cellNumber(row, col) {
  const v = row.getCell(col).value;
  if (typeof v === 'number') return v;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

function cellDate(row, col) {
  const v = row.getCell(col).value;
  if (v instanceof Date) return v;
  if (typeof v === 'string') {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(v.trim());
    if (m) {
      const [, dia, mes, anio] = m;
      const fecha = new Date(`${anio}-${mes}-${dia}`);
      return isNaN(fecha.getTime()) ? null : fecha;
    }
  }
  return null;
}

module.exports = { cellText, cellNumber, cellDate };
