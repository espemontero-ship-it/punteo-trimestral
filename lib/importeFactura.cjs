// CUÁNTO VALE UNA FACTURA. Este es el único sitio que lo responde.
//
// Antes había seis respuestas distintas repartidas por la app: el número más
// grande en la pantalla de Facturas, el número más grande en el cruce, el
// primero de la lista en Proyectos, sumas de dos y de tres en un camino aparte,
// y una cuenta escrita a mano para "comprobar" que el 22/8/2026 desemparejó dos
// facturas que estaban bien. Mientras haya más de una respuesta, se contradicen.
//
// Un archivo puede traer una factura --lo normal-- o varias. Se guarda el total
// de cada una, y el importe del archivo es SU SUMA.
//
// Todo se compara en CÉNTIMOS ENTEROS. Con decimales aparece el ruido de la
// coma flotante (22,79 + 20,99 puede dar 43,779999...) y ese ruido es el que
// obligaba a poner márgenes de tolerancia. En enteros no hace falta ninguno:
// 2279 + 2099 son 4378, exacto.

function aCentimos(valor) {
  const n = Number(valor);
  return isNaN(n) ? null : Math.round(n * 100);
}

// La lista de totales de una factura, en céntimos. Vacía si no se ha leído.
function centimosDeCadaFactura(factura) {
  return ((factura && factura.totales) || [])
    .map(aCentimos)
    .filter(c => c !== null);
}

// El importe del archivo, en céntimos enteros. null si no se ha leído ninguno.
function centimosDeFactura(factura) {
  const trozos = centimosDeCadaFactura(factura);
  if (trozos.length === 0) return null;
  return trozos.reduce((a, b) => a + b, 0);
}

// El mismo importe, en euros, para enseñarlo. Nunca para comparar.
function importeDeFactura(factura) {
  const c = centimosDeFactura(factura);
  return c === null ? null : c / 100;
}

// Lo que vale un movimiento del banco, en céntimos y CON SU SIGNO: un gasto es
// negativo y un ingreso positivo. El signo importa -- una factura normal
// justifica un gasto y una rectificativa un ingreso.
function centimosDeMovimiento(movimiento) {
  return aCentimos(movimiento && movimiento.importe);
}

module.exports = {
  aCentimos, centimosDeCadaFactura, centimosDeFactura, importeDeFactura, centimosDeMovimiento,
};
