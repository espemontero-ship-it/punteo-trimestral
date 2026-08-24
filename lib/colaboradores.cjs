const bcrypt = require('bcryptjs');
const { query } = require('./db.cjs');
const { crearInvitacion } = require('./tokens.cjs');
const { enviarInvitacion } = require('./email.cjs');

async function verificarColaborador(usuario, password) {
  const { rows } = await query(
    `SELECT id, nombre, usuario, password_hash, rol, estado FROM colaboradores WHERE usuario = $1`,
    [usuario]
  );
  if (rows.length === 0) return null;
  const colaborador = rows[0];
  const ok = await bcrypt.compare(password || '', colaborador.password_hash);
  if (!ok) return null;
  return { id: colaborador.id, nombre: colaborador.nombre, usuario: colaborador.usuario, rol: colaborador.rol, estado: colaborador.estado };
}

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

async function crearColaboradorDesdeInvitacion(nombre, usuario, passwordHash, puedeSubirFacturasGenerales) {
  const { rows } = await query(
    `INSERT INTO colaboradores (nombre, usuario, password_hash, puede_subir_facturas_generales)
     VALUES ($1, $2, $3, $4) RETURNING id, nombre, usuario`,
    [nombre, usuario, passwordHash, !!puedeSubirFacturasGenerales]
  );
  return { colaborador: rows[0] };
}

async function altaColaborador({ nombre, usuario, puedeSubirFacturasGenerales, invitadoPor }) {
  const { rows: existentes } = await query(`SELECT id, nombre, usuario FROM colaboradores WHERE usuario = $1`, [usuario]);

  if (existentes.length > 0) {
    const colaborador = existentes[0];
    if (puedeSubirFacturasGenerales) {
      await actualizarPermisoFacturasGenerales(colaborador.id, true);
    }
    return { yaExistia: true, colaborador };
  }

  const token = await crearInvitacion({ nombre, usuario, invitadoPor, puedeSubirFacturasGenerales: !!puedeSubirFacturasGenerales });
  const enlace = `${process.env.SITE_URL || ''}/invitacion/${token}`;
  await enviarInvitacion(usuario, { nombre, enlace });
  return { yaExistia: false, enlace };
}

module.exports = {
  verificarColaborador, listarColaboradores, obtenerColaborador,
  actualizarEstadoColaborador, actualizarPermisoInvitar, actualizarPermisoFacturasGenerales, crearColaboradorDesdeInvitacion,
  altaColaborador,
};
