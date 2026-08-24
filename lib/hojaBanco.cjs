const { cellText } = require('./cells.cjs');

function buscarFilaCabecera(ws, cabeceraContiene, limite = 40) {
  for (let r = 1; r <= Math.min(limite, ws.rowCount); r++) {
    const row = ws.getRow(r);
    const textos = [];
    for (let c = 1; c <= (row.cellCount || 0); c++) {
      const t = cellText(row, c);
      if (t) textos.push(t.toUpperCase());
    }
    if (textos.length === 0) continue;
    const encontrada = cabeceraContiene.every(palabra => textos.some(t => t.includes(palabra.toUpperCase())));
    if (encontrada) return r;
  }
  return null;
}

function localizarColumnas(ws, filaCabecera, columnasCfg) {
  const row = ws.getRow(filaCabecera);
  const totalCols = Math.max(ws.columnCount || 0, row.cellCount || 0);
  const cabecera = [];
  let ultimaConTexto = 0;
  for (let c = 1; c <= totalCols; c++) {
    const nombre = cellText(row, c);
    cabecera.push({ col: c, nombre });
    if (nombre) ultimaConTexto = c;
  }

  function coincide(nombreCabecera, alias) {
    return alias.some(alt => nombreCabecera.toUpperCase().includes(alt.toUpperCase()));
  }

  function buscarColumnaUnica(alias) {
    const encontrada = cabecera.find(({ nombre }) => nombre && coincide(nombre, alias));
    return encontrada ? encontrada.col : null;
  }

  function buscarColumnasMultiples(alias) {
    return cabecera.filter(({ nombre }) => nombre && coincide(nombre, alias)).map(c => c.col);
  }

  function columnasDeTexto() {
    if (!columnasCfg.textoExcluir) return buscarColumnasMultiples(columnasCfg.texto || []);
    const fechaCol = buscarColumnaUnica(columnasCfg.fecha || []);
    const importeCol = buscarColumnaUnica(columnasCfg.importe || []);
    return cabecera
      .filter(({ col, nombre }) => {
        if (col === fechaCol || col === importeCol) return false;

        if (fechaCol && col < fechaCol) return false;

        if (col > ultimaConTexto + 2) return false;
        if (!nombre) return true;
        return !coincide(nombre, columnasCfg.textoExcluir);
      })
      .map(c => c.col);
  }

  function columnaOrdenante() {
    const porNombre = buscarColumnaUnica(columnasCfg.ordenante || []);
    if (porNombre) return porNombre;
    const conceptoCol = buscarColumnaUnica(['CONCEPTO']);
    if (!conceptoCol) return null;
    const siguiente = cabecera.find(c => c.col === conceptoCol + 1);
    return siguiente && !siguiente.nombre ? siguiente.col : null;
  }

  return {
    cabecera,
    fecha: buscarColumnaUnica(columnasCfg.fecha || []),
    importe: buscarColumnaUnica(columnasCfg.importe || []),
    texto: columnasDeTexto(),
    ordenante: columnaOrdenante(),
    notaCol: ultimaConTexto + 1,
  };
}

function detectarHoja(ws, cfg) {
  const filaCabecera = buscarFilaCabecera(ws, cfg.cabeceraContiene);
  if (filaCabecera === null) return null;
  const { cabecera, notaCol, ...columnas } = localizarColumnas(ws, filaCabecera, cfg.columnas);
  return { filaCabecera, dataStartRow: filaCabecera + 1, cabecera, notaCol, columnas };
}

module.exports = { detectarHoja };
