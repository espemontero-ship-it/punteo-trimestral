const { normalizeKey, clasificarClave } = require('./normalize.cjs');
const sheetsConfig = require('../config/sheets.json').sheets;
const { cellText, cellNumber } = require('./cells.cjs');

const ETIQUETAS = {
  nueva: () => '🆕 nuevo',
  factura_propia: () => '📄 factura propia',
  fija: c => `✅ ${c.sugerenciaNota}`,
  mixta: () => '⚠️ histórico mixto',
};

function aplicarClasificacion(wb, memoria) {
  const resumen = [];

  for (const cfg of sheetsConfig) {
    const ws = wb.getWorksheet(cfg.nombre);
    if (!ws) continue;

    const memoriaHoja = memoria[cfg.nombre] || {};
    const lastCol = ws.columnCount;
    const colSugerencia = lastCol + 2;
    const colDetalle = lastCol + 3;

    ws.getRow(cfg.dataStartRow - 1).getCell(colSugerencia).value = 'Sugerencia (auto)';
    ws.getRow(cfg.dataStartRow - 1).getCell(colDetalle).value = 'Detalle';
    ws.getRow(cfg.dataStartRow - 1).getCell(colSugerencia).font = { bold: true };
    ws.getRow(cfg.dataStartRow - 1).getCell(colDetalle).font = { bold: true };

    let nuevas = 0, fijas = 0, propias = 0, mixtas = 0;
    const clavesNuevas = new Set();

    for (let r = cfg.dataStartRow; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const texto = cfg.textCols.map(c => cellText(row, c)).filter(Boolean).join(' ');
      if (!texto) continue;
      const importe = cfg.importeCol ? cellNumber(row, cfg.importeCol) : null;
      const key = normalizeKey(texto, importe);

      const clasificacion = clasificarClave(memoriaHoja[key]);
      const sugerencia = ETIQUETAS[clasificacion.categoria](clasificacion);

      if (clasificacion.categoria === 'nueva') { nuevas++; clavesNuevas.add(key); }
      else if (clasificacion.categoria === 'fija') fijas++;
      else if (clasificacion.categoria === 'factura_propia') propias++;
      else mixtas++;

      row.getCell(colSugerencia).value = sugerencia;
      row.getCell(colDetalle).value = clasificacion.detalle;
    }

    resumen.push({ hoja: cfg.nombre, nuevas, fijas, propias, mixtas, clavesNuevas: [...clavesNuevas] });
  }

  return resumen;
}

function escribirResumenClasificacion(wb, resumen) {
  const ws = wb.addWorksheet('Resumen clasificación');
  ws.addRow(['Hoja', 'Nuevas (sin historial)', 'Sugerencia fija', 'Factura propia/patrón', 'Histórico mixto']).font = { bold: true };
  for (const r of resumen) ws.addRow([r.hoja, r.nuevas, r.fijas, r.propias, r.mixtas]);
  ws.addRow([]);
  ws.addRow(['Claves nuevas por hoja (revisar y clasificar):']).font = { bold: true };
  for (const r of resumen) {
    if (r.clavesNuevas.length === 0) continue;
    ws.addRow([r.hoja]);
    for (const k of r.clavesNuevas) ws.addRow(['', k]);
  }
  ws.columns.forEach(c => { c.width = 45; });
}

module.exports = { aplicarClasificacion, escribirResumenClasificacion };
