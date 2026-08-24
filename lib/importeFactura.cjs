function aCentimos(valor) {
  const n = Number(valor);
  return isNaN(n) ? null : Math.round(n * 100);
}

function centimosDeCadaFactura(factura) {
  return ((factura && factura.totales) || [])
    .map(aCentimos)
    .filter(c => c !== null);
}

function centimosDeFactura(factura) {
  const trozos = centimosDeCadaFactura(factura);
  if (trozos.length === 0) return null;
  return trozos.reduce((a, b) => a + b, 0);
}

function importeDeFactura(factura) {
  const c = centimosDeFactura(factura);
  return c === null ? null : c / 100;
}

function centimosDeMovimiento(movimiento) {
  return aCentimos(movimiento && movimiento.importe);
}

module.exports = {
  aCentimos, centimosDeCadaFactura, centimosDeFactura, importeDeFactura, centimosDeMovimiento,
};
