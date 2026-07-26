const sheetsConfig = require('../config/sheets.json').sheets;
const { cellText, cellNumber, cellDate } = require('./cells.cjs');
const { montoCaracteristico } = require('./facturas.cjs');
const { pistasProveedor } = require('./normalize.cjs');

const TOLERANCIA_IMPORTE = 0.01;
const TOLERANCIA_COMBO = 0.02;
const VENTANA_DIAS_COMBO = 20;

function aplicarMatching(wb, facturas) {
  const numerosFactura = Object.keys(facturas);
  const usoFactura = {};
  numerosFactura.forEach(n => { usoFactura[n] = 0; });

  const montos = numerosFactura
    .map(n => ({ numero: n, monto: montoCaracteristico(facturas[n]) }))
    .filter(x => x.monto !== null);

  const resumen = [];

  for (const cfg of sheetsConfig) {
    const ws = wb.getWorksheet(cfg.nombre);
    if (!ws || !cfg.importeCol) continue;

    const lastCol = ws.columnCount;
    const colCandidata = lastCol + 2;
    const colAviso = lastCol + 3;
    ws.getRow(cfg.dataStartRow - 1).getCell(colCandidata).value = 'Factura candidata (por importe)';
    ws.getRow(cfg.dataStartRow - 1).getCell(colAviso).value = 'Aviso';
    ws.getRow(cfg.dataStartRow - 1).getCell(colCandidata).font = { bold: true };
    ws.getRow(cfg.dataStartRow - 1).getCell(colAviso).font = { bold: true };

    let conCandidata = 0, sinCandidata = 0, discrepancias = 0, combinadas = 0;

    for (let r = cfg.dataStartRow; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const importe = cellNumber(row, cfg.importeCol);
      if (importe === null || importe === 0) continue;
      const absImporte = Math.abs(importe);
      const fechaMov = cfg.fechaCol ? cellDate(row, cfg.fechaCol) : null;
      const notaActual = cfg.notaCol ? cellText(row, cfg.notaCol) : '';
      const textoConcepto = cfg.textCols.map(c => cellText(row, c)).filter(Boolean).join(' ');

      const buscar = campo => numerosFactura
        .filter(n => (facturas[n][campo] || []).some(v => Math.abs(v - absImporte) <= TOLERANCIA_IMPORTE))
        .map(n => ({ numero: n, diasDiff: diferenciaDias(fechaMov, facturas[n].fechas) }))
        .sort((a, b) => (a.diasDiff ?? 9999) - (b.diasDiff ?? 9999));

      let candidatas = buscar('totales');
      let confianzaBaja = false;

      if (candidatas.length === 0) {
        candidatas = buscar('importes');
        confianzaBaja = candidatas.length > 0;
      }

      let combo = null;
      if (candidatas.length === 0) {
        const pistas = pistasProveedor(textoConcepto);
        const montosAcotados = acotarPorPistaYFecha(montos, facturas, pistas, fechaMov);
        combo = buscarCombinacion(montosAcotados, absImporte, 2) || buscarCombinacion(montosAcotados, absImporte, 3);
      }

      let candidataTexto = '', aviso = '';

      if (combo) {
        candidataTexto = combo.map(c => c.numero).join(' + ');
        combo.forEach(c => usoFactura[c.numero]++);
        conCandidata++; combinadas++;
        aviso = `Posible combinación: facturas ${combo.map(c => c.numero).join(' + ')} suman ${absImporte.toFixed(2)} — verificar.`;
      } else if (candidatas.length === 0) {
        candidataTexto = '';
        aviso = 'Sin factura en la carpeta con ese importe (sola o combinada).';
        sinCandidata++;
      } else {
        candidataTexto = candidatas.map(c => c.numero).join(', ');
        candidatas.forEach(c => usoFactura[c.numero]++);
        conCandidata++;

        if (notaActual && /^\d+/.test(notaActual)) {
          const notaNumeros = notaActual.match(/\d+/g) || [];
          const coincide = notaNumeros.some(nn => candidatas.some(c => c.numero === nn));
          if (!coincide) {
            aviso = `⚠️ tu nota dice "${notaActual}" pero el importe coincide con: ${candidataTexto}`;
            discrepancias++;
          } else {
            aviso = '✅ coincide con tu nota';
          }
        } else if (confianzaBaja) {
          aviso = 'Coincide con una cantidad suelta del PDF (no un "total") — verificar.';
        } else if (candidatas.length > 1) {
          aviso = `${candidatas.length} facturas con ese mismo importe, usa la fecha para desambiguar.`;
        }
      }

      row.getCell(colCandidata).value = candidataTexto;
      row.getCell(colAviso).value = aviso;
    }

    resumen.push({ hoja: cfg.nombre, conCandidata, sinCandidata, discrepancias, combinadas });
  }

  const huerfanas = numerosFactura.filter(n => usoFactura[n] === 0 && !facturas[n].esImagen);
  const imagenes = numerosFactura.filter(n => facturas[n].esImagen);

  return { resumen, huerfanas, imagenes, facturas };
}

// Restringe el universo de facturas candidatas a combinar: deben compartir una
// palabra clave con el concepto del banco (ej. "AMAZON") y tener fecha cercana
// al movimiento, para evitar sumas coincidentes entre proveedores distintos.
function acotarPorPistaYFecha(montos, facturas, pistas, fechaMov) {
  return montos.filter(({ numero }) => {
    const f = facturas[numero];
    const coincidePista = pistas.length === 0 || pistas.some(p => (f.textoMayus || '').includes(p));
    if (!coincidePista) return false;
    if (fechaMov && f.fechas && f.fechas.length) {
      const dias = diferenciaDias(fechaMov, f.fechas);
      if (dias !== null && dias > VENTANA_DIAS_COMBO) return false;
    }
    return true;
  });
}

// Busca `n` facturas (por su monto característico) cuya suma cuadre con el objetivo.
function buscarCombinacion(montos, objetivo, n) {
  const indices = montos.map((_, i) => i);
  const combo = combinarIndices(indices, n);
  for (const grupo of combo) {
    const suma = grupo.reduce((acc, i) => acc + montos[i].monto, 0);
    if (Math.abs(suma - objetivo) <= TOLERANCIA_COMBO) {
      return grupo.map(i => montos[i]);
    }
  }
  return null;
}

function* combinarIndices(indices, n, start = 0, actual = []) {
  if (actual.length === n) {
    yield [...actual];
    return;
  }
  for (let i = start; i < indices.length; i++) {
    actual.push(indices[i]);
    yield* combinarIndices(indices, n, i + 1, actual);
    actual.pop();
  }
}

function diferenciaDias(fechaMov, fechasFactura) {
  if (!fechaMov || !fechasFactura || fechasFactura.length === 0) return null;
  let min = null;
  for (const f of fechasFactura) {
    const dias = Math.abs((fechaMov.getTime() - f.getTime()) / 86400000);
    if (min === null || dias < min) min = dias;
  }
  return min;
}

function escribirResumenFacturas(wb, { resumen, huerfanas, imagenes, facturas }) {
  const ws = wb.addWorksheet('Resumen facturas');
  ws.addRow(['Hoja', 'Con factura candidata', 'Sin factura en carpeta', 'Discrepancias con tu nota', 'Combinaciones detectadas']).font = { bold: true };
  for (const r of resumen) ws.addRow([r.hoja, r.conCandidata, r.sinCandidata, r.discrepancias, r.combinadas]);
  ws.addRow([]);
  ws.addRow([`Facturas en la carpeta sin ningún movimiento bancario que coincida en importe (${huerfanas.length}):`]).font = { bold: true };
  huerfanas.forEach(n => ws.addRow(['', facturas[n].archivo, `importes leídos: ${(facturas[n].importes || []).join(' / ') || '(ninguno)'}`]));
  ws.addRow([]);
  ws.addRow([`Imágenes sin texto legible, revisar a mano (${imagenes.length}):`]).font = { bold: true };
  imagenes.forEach(n => ws.addRow(['', facturas[n].archivo]));
  ws.columns.forEach(c => { c.width = 40; });
}

module.exports = { aplicarMatching, escribirResumenFacturas };
