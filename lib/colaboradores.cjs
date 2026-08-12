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

// A pesar del nombre, verifica cualquier fila de `colaboradores` -- incluida
// la de administradora (rol='admin'), que es una fila más de esta misma
// tabla. El caller decide qué hacer según el `rol` devuelto.
async function verificarColaborador(usuario, password) {
  const { rows } = await query(
    `SELECT id, nombre, usuario, password_hash, rol FROM colaboradores WHERE usuario = $1`,
    [usuario]
  );
  if (rows.length === 0) return null;
  const colaborador = rows[0];
  const ok = await bcrypt.compare(password || '', colaborador.password_hash);
  if (!ok) return null;
  return { id: colaborador.id, nombre: colaborador.nombre, usuario: colaborador.usuario, rol: colaborador.rol };
}

// Solo colaboradores de verdad -- nunca expone la fila de administradora.
async function listarColaboradores() {
  const { rows } = await query(
    `SELECT id, nombre, usuario, estado, puede_invitar, creado_en FROM colaboradores WHERE rol = 'colaborador' ORDER BY nombre`
  );
  return rows;
}

async function obtenerColaborador(colaboradorId) {
  const { rows } = await query(
    `SELECT id, nombre, usuario, estado, puede_invitar, puede_subir_facturas_generales FROM colaboradores WHERE id = $1`,
    [colaboradorId]
  );
  return rows[0] || null;
}

async function actualizarEstadoColaborador(colaboradorId, estado) {
  if (estado !== 'activo' && estado !== 'inactivo') {
    throw Object.assign(new Error("Estado inválido: debe ser 'activo' o 'inactivo'."), { status: 400 });
  }
  await query(`UPDATE colaboradores SET estado = $2 WHERE id = $1`, [colaboradorId, estado]);
}

async function actualizarPermisoInvitar(colaboradorId, puedeInvitar) {
  await query(`UPDATE colaboradores SET puede_invitar = $2 WHERE id = $1`, [colaboradorId, !!puedeInvitar]);
}

async function actualizarPermisoFacturasGenerales(colaboradorId, puedeSubirFacturasGenerales) {
  await query(`UPDATE colaboradores SET puede_subir_facturas_generales = $2 WHERE id = $1`, [colaboradorId, !!puedeSubirFacturasGenerales]);
}

// Crea el colaborador ya con la contraseña que ha elegido él mismo (viene de
// aceptar una invitación, nunca generada/dictada). Si la invitación traía
// proyecto, se le crea también su lote; si no (caso "solo sube facturas de
// NOL, sin proyecto"), se queda sin ningún lote.
async function crearColaboradorDesdeInvitacion(nombre, usuario, passwordHash, proyectoId, puedeSubirFacturasGenerales) {
  const { rows } = await query(
    `INSERT INTO colaboradores (nombre, usuario, password_hash, puede_subir_facturas_generales)
     VALUES ($1, $2, $3, $4) RETURNING id, nombre, usuario`,
    [nombre, usuario, passwordHash, !!puedeSubirFacturasGenerales]
  );
  const colaborador = rows[0];
  let loteId = null;
  if (proyectoId) {
    const { crearLote, trimestreActual } = require('./lotes.cjs');
    loteId = await crearLote(trimestreActual(), colaborador.id, proyectoId);
  }
  return { colaborador, loteId };
}

module.exports = {
  crearColaborador, verificarColaborador, listarColaboradores, obtenerColaborador,
  actualizarEstadoColaborador, actualizarPermisoInvitar, actualizarPermisoFacturasGenerales, crearColaboradorDesdeInvitacion,
};
