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

function fechaCorta(fecha) {
  if (!fecha) return 'sin fecha';
  if (fecha instanceof Date) return `${fecha.getDate()}/${fecha.getMonth() + 1}`;
  const [, mes, dia] = String(fecha).slice(0, 10).split('-');
  return mes && dia ? `${Number(dia)}/${Number(mes)}` : 'sin fecha';
}

function sumaDeMovimientos(movimientos) {
  return movimientos.reduce((acc, m) => acc + Math.abs(aCentimos(m.importe) || 0), 0) / 100;
}

function textoCubreVarios({ propia, movimientos }) {
  const lista = movimientos.map(m => `${fechaCorta(m.fecha)} ${Math.abs(Number(m.importe)).toFixed(2)}€`).join(' · ');
  return `Esta factura (${conProveedor(propia.monto, propia.proveedor)}) cubre ${movimientos.length} movimientos que suman ${
    sumaDeMovimientos(movimientos).toFixed(2)}€: ${lista}.`;
}

function textoCubreVariosCorto({ numero, proveedor, movimientos }) {
  return `factura ${numero}${proveedor ? ` (${proveedor})` : ''} · ${movimientos.length} movimientos · ${sumaDeMovimientos(movimientos).toFixed(2)}€`;
}

module.exports = { textoComboFacturas, avisoDeDesvio, textoCubreVarios, textoCubreVariosCorto, sumaDeMovimientos };
