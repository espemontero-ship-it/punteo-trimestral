// Lectura de un importe escrito a mano o extraído de un PDF, en formato
// español (1.234,56) o internacional (1,234.56).
//
// El separador decimal es el ÚLTIMO de los dos símbolos que aparezcan; el
// otro, si lo hay, es el de millares y se descarta. Vivía dentro de
// lib/facturas.cjs y solo lo usaba la lectura de PDF: las pantallas hacían
// `.replace(',', '.')`, que cambia únicamente la PRIMERA coma. Con "2.183,18"
// eso daba "2.183.18" -- ni número ni aviso: el campo se quedaba mudo y
// parecía que no encontraba la línea. Cualquier importe de mil para arriba
// escrito a la española se perdía en silencio.
//
// Sin dependencias de Node a propósito: lo usan tanto el servidor como los
// componentes del navegador.
function parseImporte(raw) {
  const limpio = String(raw ?? '').trim();
  if (!limpio) return NaN;
  const ultimaComa = limpio.lastIndexOf(',');
  const ultimoPunto = limpio.lastIndexOf('.');
  if (ultimoPunto > ultimaComa) return parseFloat(limpio.replace(/,/g, ''));
  return parseFloat(limpio.replace(/\./g, '').replace(',', '.'));
}

module.exports = { parseImporte };
