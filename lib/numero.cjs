function parseImporte(raw) {
  const limpio = String(raw ?? '').trim();
  if (!limpio) return NaN;
  const ultimaComa = limpio.lastIndexOf(',');
  const ultimoPunto = limpio.lastIndexOf('.');
  if (ultimoPunto > ultimaComa) return parseFloat(limpio.replace(/,/g, ''));
  return parseFloat(limpio.replace(/\./g, '').replace(',', '.'));
}

module.exports = { parseImporte };
