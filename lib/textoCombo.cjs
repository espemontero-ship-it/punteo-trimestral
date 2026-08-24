const { aCentimos } = require('./importeFactura.cjs');

function avisoDeDesvio(centimos) {
  if (centimos === 0) return '';
  return ` NO CUADRA: ${centimos > 0 ? 'faltan' : 'sobran'} ${(Math.abs(centimos) / 100).toFixed(2)}€. Compruébalo antes de aceptar.`;
}

function conProveedor(monto, proveedor) {
  const importe = `${Number(monto).toFixed(2)}€`;
  return proveedor ? `${importe}, ${proveedor}` : importe;
}

function textoComboFacturas({ propia, otras, linea }) {
  const otrasTexto = otras
    .map(o => `la factura ${o.numero} (${conProveedor(o.monto, o.proveedor)})`)
    .join(' + ');
  const suma = [propia, ...otras].reduce((acc, f) => acc + (aCentimos(f.monto) || 0), 0);
  const importeLinea = Math.abs(Number(linea.importe));
  const desvio = Math.round(importeLinea * 100) - suma;
  const concepto = String(linea.concepto || '').trim();
  const dela = `${importeLinea.toFixed(2)}€${concepto ? ` ("${concepto}")` : ''}`;
  return `Esta factura (${conProveedor(propia.monto, propia.proveedor)}) + ${otrasTexto} suman ${
    (suma / 100).toFixed(2)}€, contra la línea de ${dela}.${avisoDeDesvio(desvio)}`;
}

module.exports = { textoComboFacturas, avisoDeDesvio };
