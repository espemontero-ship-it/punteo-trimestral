const { query } = require('./db.cjs');

const RE_DEVOLUCION = /devoluci[oó]n|refund|reembolso/i;

const RE_A_FAVOR_DE = /TRANSFERENCIAS?(?:\s+INMEDIATA)?\s+A\s+FAVOR\s+DE\s+(.+?)(?:\s+CONCEPTO:.*)?$/i;
const RE_TRANSFERENCIAS_BBVA = /^TRANSFERENCIAS?\s+(.+)$/i;
const RE_PAYPAL_TIPO = /\s+(Pago\b|Reembolso\b|Transferencia\b)/i;

function esProbableDevolucion(concepto) {
  return RE_DEVOLUCION.test(concepto || '');
}

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

async function marcarDevolucion(movimientoId, jugador) {
  await asegurarColumnasDevolucion();
  const limpio = (jugador || '').trim() || null;
  await query(
    `UPDATE movimientos SET estado = 'resuelta', es_devolucion = true, jugador_larpmanager = $2, proveedor = NULL
     WHERE id = $1`,
    [movimientoId, limpio]
  );
}

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
