const { query } = require('./db.cjs');

async function listarProyectos() {
  const { rows } = await query('SELECT id, nombre FROM proyectos ORDER BY nombre');
  return rows;
}

async function crearProyecto(nombre) {
  const limpio = (nombre || '').trim();
  if (!limpio) throw new Error('El proyecto necesita un nombre.');
  const { rows } = await query(
    `INSERT INTO proyectos (nombre) VALUES ($1)
     ON CONFLICT (nombre) DO UPDATE SET nombre = EXCLUDED.nombre
     RETURNING id, nombre`,
    [limpio]
  );
  return rows[0];
}

async function asignarProyecto(movimientoId, proyectoId) {
  await query('UPDATE movimientos SET proyecto_id = $1 WHERE id = $2', [proyectoId || null, movimientoId]);
}

// Para cada proyecto ya creado, si su nombre aparece dentro del concepto del
// movimiento (sin distinguir mayúsculas), se sugiere ese proyecto. No decide
// nada sola si el concepto no contiene ningún nombre reconocible. También
// prueba el nombre sin el número final ("Inconscience 3" -> "Inconscience"):
// en el texto real del banco/PayPal es habitual que solo aparezca el nombre
// corto del evento, sin el número de edición.
function inferirProyecto(concepto, proyectos) {
  if (!concepto) return null;
  const textoNormalizado = concepto.toLowerCase();
  return proyectos.find(p => {
    const nombre = p.nombre.toLowerCase();
    if (textoNormalizado.includes(nombre)) return true;
    const sinNumero = nombre.replace(/\s+\d+$/, '');
    return sinNumero !== nombre && textoNormalizado.includes(sinNumero);
  }) || null;
}

module.exports = { listarProyectos, crearProyecto, asignarProyecto, inferirProyecto };
