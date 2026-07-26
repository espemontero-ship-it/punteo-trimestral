const { query } = require('./db.cjs');

// Devuelve la memoria en la forma que espera clasificarCore:
// { [hoja]: { [clave]: { total, notas: { nota: count } } } }
async function cargarMemoria() {
  const { rows } = await query('SELECT hoja, clave, nota, veces FROM memoria_proveedores');
  const memoria = {};
  for (const r of rows) {
    memoria[r.hoja] = memoria[r.hoja] || {};
    memoria[r.hoja][r.clave] = memoria[r.hoja][r.clave] || { total: 0, notas: {} };
    memoria[r.hoja][r.clave].notas[r.nota] = r.veces;
    memoria[r.hoja][r.clave].total += r.veces;
  }
  return memoria;
}

// Registra una confirmación (línea o grupo) en la memoria — incrementa el contador
// si la combinación hoja+clave+nota ya existía.
async function registrarNota(hoja, clave, nota) {
  await query(
    `INSERT INTO memoria_proveedores (hoja, clave, nota, veces)
     VALUES ($1, $2, $3, 1)
     ON CONFLICT (hoja, clave, nota) DO UPDATE SET veces = memoria_proveedores.veces + 1`,
    [hoja, clave, nota]
  );
}

module.exports = { cargarMemoria, registrarNota };
