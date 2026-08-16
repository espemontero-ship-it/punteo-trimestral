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

  // El nombre de quien paga no está siempre en la misma columna, y a veces
  // está en una que NO TIENE RÓTULO en la fila de cabecera -- en el export
  // real de BBVA, la columna del ordenante viene en blanco en la cabecera, y
  // la de anotaciones a mano tampoco tiene nombre. Buscando las columnas por
  // su rótulo, esas dos se caían del texto y el nombre no llegaba nunca.
  //
  // Por eso, cuando la config trae `textoExcluir`, se invierte el criterio:
  // entra TODA columna de la fila salvo las que se excluyen expresamente
  // (fecha e importe, que ya se leen como dato, más saldo/divisa/oficina, que
  // son números sin nombres dentro). Así una columna nueva o sin rótulo entra
  // sola en vez de perderse en silencio, que es lo que pasaba.
  function columnasDeTexto() {
    if (!columnasCfg.textoExcluir) return buscarColumnasMultiples(columnasCfg.texto || []);
    const fechaCol = buscarColumnaUnica(columnasCfg.fecha || []);
    const importeCol = buscarColumnaUnica(columnasCfg.importe || []);
    return cabecera
      .filter(({ col, nombre }) => {
        if (col === fechaCol || col === importeCol) return false;
        // A la izquierda de la fecha solo está el número de fila del banco.
        if (fechaCol && col < fechaCol) return false;
        // Y a la derecha, la cola de columnas vacías del excel. Se deja un
        // margen porque la columna de anotaciones a mano va justo después de
        // la última con rótulo (en BBVA, la M detrás de "REMESA").
        if (col > ultimaConTexto + 2) return false;
        if (!nombre) return true;                      // sin rótulo: entra
        return !coincide(nombre, columnasCfg.textoExcluir);
      })
      .map(c => c.col);
  }

  // La columna del ordenante -- quién ha hecho el ingreso -- aparte del resto
  // del texto. Es el único sitio donde el banco escribe el nombre limpio, sin
  // el "ABONO POR TRANSFERENCIA A SU FAVOR..." delante ni la referencia
  // detrás, así que sirve para aprender cómo llama el banco a esa persona sin
  // tener que adivinar qué palabras de la línea son el nombre.
  //
  // En el export real de BBVA esa columna VIENE SIN RÓTULO, así que buscarla
  // por nombre no basta: si no aparece "BENEFICIARIO"/"ORDENANTE" en la
  // cabecera, se coge la columna inmediatamente posterior a CONCEPTO cuando
  // está en blanco en la fila de cabecera, que es donde la pone BBVA.
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
