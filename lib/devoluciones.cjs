const { query } = require('./db.cjs');

// Una devolución es una alternativa a "proveedor" al resolver una línea
// saliente: en vez de un proveedor, se guarda a qué jugador se le ha
// devuelto parte de una inscripción de LarpManager y a qué proyecto
// pertenece (proyecto_id ya existía, se reutiliza). No hay export de bajas
// en LarpManager con el que cruzar automáticamente -- el nombre se escribe
// a mano, aunque se sugiere a partir del propio texto del banco.
const RE_DEVOLUCION = /devoluci[oó]n|refund|reembolso/i;

// "TRANSFERENCIA (INMEDIATA) A FAVOR DE <nombre> [CONCEPTO: ...]" es el
// patrón real de Openbank; BBVA usa el más simple "TRANSFERENCIA(S) <nombre>".
// Para PayPal, el concepto ya empieza por el nombre del destinatario (columna
// "Nombre" del export) seguido del "Tipo" ("Pago general", "Reembolso"...) --
// cortar justo antes de esa palabra deja el nombre solo.
const RE_A_FAVOR_DE = /TRANSFERENCIAS?(?:\s+INMEDIATA)?\s+A\s+FAVOR\s+DE\s+(.+?)(?:\s+CONCEPTO:.*)?$/i;
const RE_TRANSFERENCIAS_BBVA = /^TRANSFERENCIAS?\s+(.+)$/i;
const RE_PAYPAL_TIPO = /\s+(Pago\b|Reembolso\b|Transferencia\b)/i;

function esProbableDevolucion(concepto) {
  return RE_DEVOLUCION.test(concepto || '');
}

// Solo una sugerencia editable -- nunca se guarda sin que la usuaria la
// confirme (o la corrija) a mano.
function sugerirJugador(concepto) {
  if (!concepto) return null;
  const c = concepto.trim();
  let m = c.match(RE_A_FAVOR_DE);
  if (m) return m[1].trim();
  m = c.match(RE_TRANSFERENCIAS_BBVA);
  if (m) return m[1].trim();
  m = c.match(RE_PAYPAL_TIPO);
  if (m && m.index > 0) return c.slice(0, m.index).trim();
  return null;
}

let columnasDevolucionAseguradas = false;
async function asegurarColumnasDevolucion() {
  if (columnasDevolucionAseguradas) return;
  await query(`ALTER TABLE movimientos ADD COLUMN IF NOT EXISTS es_devolucion BOOLEAN NOT NULL DEFAULT false`);
  await query(`ALTER TABLE movimientos ADD COLUMN IF NOT EXISTS jugador_larpmanager TEXT`);
  columnasDevolucionAseguradas = true;
}

// Marca la línea como devolución y la da por resuelta directamente (no hay
// factura ni proveedor que emparejar) -- quita cualquier proveedor que
// hubiera, porque son dos formas de resolución que no conviven en la misma
// línea.
async function marcarDevolucion(movimientoId, jugador) {
  await asegurarColumnasDevolucion();
  const limpio = (jugador || '').trim() || null;
  await query(
    `UPDATE movimientos SET estado = 'resuelta', es_devolucion = true, jugador_larpmanager = $2, proveedor = NULL
     WHERE id = $1`,
    [movimientoId, limpio]
  );
}

// Para revisar/exportar al generar un envío a gestoría (pestaña
// "Devoluciones" del excel final). `desde`/`hasta` (opcionales) acotan por
// fecha -- sin ellos, trae todas las devoluciones del histórico.
async function listarDevolucionesEnRango(desde, hasta) {
  await asegurarColumnasDevolucion();
  const condiciones = ['m.es_devolucion = true'];
  const params = [];
  if (desde) { params.push(desde); condiciones.push(`m.fecha >= $${params.length}`); }
  if (hasta) { params.push(hasta); condiciones.push(`m.fecha <= $${params.length}`); }
  const { rows } = await query(
    `SELECT m.id, m.fecha, m.importe, m.jugador_larpmanager, m.nota_final, p.nombre AS proyecto
     FROM movimientos m LEFT JOIN proyectos p ON p.id = m.proyecto_id
     WHERE ${condiciones.join(' AND ')}
     ORDER BY m.fecha`,
    params
  );
  return rows;
}

// Un proyecto no vive dentro de un trimestre -- al cerrarlo hace falta ver
// todas sus devoluciones aunque estén repartidas en distintas fechas.
async function listarDevolucionesProyecto(proyectoId) {
  await asegurarColumnasDevolucion();
  const { rows } = await query(
    `SELECT m.id, m.fecha, m.importe, m.jugador_larpmanager, m.nota_final
     FROM movimientos m
     WHERE m.proyecto_id = $1 AND m.es_devolucion = true
     ORDER BY m.fecha`,
    [proyectoId]
  );
  return rows;
}

module.exports = {
  esProbableDevolucion, sugerirJugador, asegurarColumnasDevolucion,
  marcarDevolucion, listarDevolucionesEnRango, listarDevolucionesProyecto,
};
