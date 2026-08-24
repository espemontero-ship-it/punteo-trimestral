const { query } = require('./db.cjs');
const { asegurarEsquemaReembolso } = require('./lotes.cjs');

async function listarProyectos() {
  await asegurarEsquemaReembolso();
  const { rows } = await query('SELECT id, nombre, estado FROM proyectos ORDER BY nombre');
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

async function cerrarProyecto(proyectoId) {
  await asegurarEsquemaReembolso();
  await query(`UPDATE proyectos SET estado = 'cerrado' WHERE id = $1`, [proyectoId]);
}

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

module.exports = {
  listarProyectos, crearProyecto, asignarProyecto, inferirProyecto,
  cerrarProyecto,
};
