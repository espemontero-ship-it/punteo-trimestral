const bcrypt = require('bcryptjs');
const { query } = require('./db.cjs');

function generarPassword() {
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 10; i++) out += alfabeto[Math.floor(Math.random() * alfabeto.length)];
  return out;
}

// Crea un colaborador nuevo. Si no se pasa password, se genera una legible
// para poder dictársela/escribírsela sin líos.
async function crearColaborador(nombre, usuario, password) {
  const passwordFinal = password || generarPassword();
  const hash = await bcrypt.hash(passwordFinal, 10);
  const { rows } = await query(
    `INSERT INTO colaboradores (nombre, usuario, password_hash) VALUES ($1, $2, $3) RETURNING id, nombre, usuario`,
    [nombre, usuario, hash]
  );
  return { ...rows[0], password: passwordFinal };
}

async function verificarColaborador(usuario, password) {
  const { rows } = await query(
    `SELECT id, nombre, usuario, password_hash FROM colaboradores WHERE usuario = $1`,
    [usuario]
  );
  if (rows.length === 0) return null;
  const colaborador = rows[0];
  const ok = await bcrypt.compare(password || '', colaborador.password_hash);
  if (!ok) return null;
  return { id: colaborador.id, nombre: colaborador.nombre, usuario: colaborador.usuario };
}

async function listarColaboradores() {
  const { rows } = await query(`SELECT id, nombre, usuario, estado, creado_en FROM colaboradores ORDER BY nombre`);
  return rows;
}

async function actualizarEstadoColaborador(colaboradorId, estado) {
  if (estado !== 'activo' && estado !== 'inactivo') {
    throw Object.assign(new Error("Estado inválido: debe ser 'activo' o 'inactivo'."), { status: 400 });
  }
  await query(`UPDATE colaboradores SET estado = $2 WHERE id = $1`, [colaboradorId, estado]);
}

module.exports = { crearColaborador, verificarColaborador, listarColaboradores, actualizarEstadoColaborador };
