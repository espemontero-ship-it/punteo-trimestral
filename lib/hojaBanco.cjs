const { cellText } = require('./cells.cjs');

// Los exports reales del banco no tienen las columnas en una posición fija:
// BBVA mete un bloque de metadatos (Titular, Cuenta, Periodo...) antes de la
// tabla, cuyo tamaño puede variar de una descarga a otra, y las columnas no
// siempre caen en la misma letra. En vez de asumir una fila/columna fija (que
// es justo lo que falló al probar con el excel real por primera vez), se
// busca la fila de cabecera de verdad y se localizan las columnas por su
// nombre.

// Recorre las primeras filas buscando una que contenga, como texto de
// celda, todas las palabras de cfg.cabeceraContiene -- esa es la cabecera
// real de la tabla, esté donde esté.
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

// Empareja cada campo con su columna real, y localiza además la primera
// columna vacía de la cabecera para poder escribir ahí la nota sin
// arriesgarse a pisar una columna real del banco (ej. en BBVA la "M" ya es
// "REMESA", una referencia bancaria real -- no un hueco libre).
//
// "fecha" e "importe" son un único campo, se quedan con la primera columna
// que encaje. "texto" es varias columnas a la vez -- en BBVA el nombre real
// de quien paga no está en CONCEPTO ("TRANSFERENCIAS", genérico) sino en
// BENEFICIARIO/ORDENANTE, y la referencia (ej. la que manda LarpManager) cae
// en OBSERVACIONES -- hace falta juntar las tres para tener algo con lo que
// emparejar facturas o pagos de verdad.
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

  return {
    cabecera,
    fecha: buscarColumnaUnica(columnasCfg.fecha || []),
    importe: buscarColumnaUnica(columnasCfg.importe || []),
    texto: buscarColumnasMultiples(columnasCfg.texto || []),
    notaCol: ultimaConTexto + 1,
  };
}

// Punto único: dada una hoja y su config de "modo nombres" (ver
// config/sheets.json), devuelve dónde empiezan los datos y en qué columna
// está cada campo -- import y export usan exactamente esta misma función,
// para que nunca puedan quedar desincronizados entre sí (que fue la otra
// causa del fallo original: dos sitios adivinando la misma columna por
// separado, cada uno con su propia suposición).
function detectarHoja(ws, cfg) {
  const filaCabecera = buscarFilaCabecera(ws, cfg.cabeceraContiene);
  if (filaCabecera === null) return null;
  const { cabecera, notaCol, ...columnas } = localizarColumnas(ws, filaCabecera, cfg.columnas);
  return { filaCabecera, dataStartRow: filaCabecera + 1, cabecera, notaCol, columnas };
}

module.exports = { detectarHoja };
