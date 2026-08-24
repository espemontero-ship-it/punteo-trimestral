const { query } = require('./db.cjs');

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

const SOLO_NUMEROS = /^[0-9]+(\s*(\+|y|,)\s*[0-9]+)*$/i;

async function registrarNota(hoja, clave, nota) {
  const limpia = (nota ?? '').trim();
  if (SOLO_NUMEROS.test(limpia)) return;
  await query(
    `INSERT INTO memoria_proveedores (hoja, clave, nota, veces)
     VALUES ($1, $2, $3, 1)
     ON CONFLICT (hoja, clave, nota) DO UPDATE SET veces = memoria_proveedores.veces + 1`,
    [hoja, clave, limpia]
  );
}

async function cargarMemoriaProveedor() {
  const { rows } = await query('SELECT hoja, clave, nombre, veces FROM memoria_proveedor_nombre');
  const memoria = {};
  for (const r of rows) {
    memoria[r.hoja] = memoria[r.hoja] || {};
    const actual = memoria[r.hoja][r.clave];
    if (!actual || r.veces > actual.veces) {
      memoria[r.hoja][r.clave] = { nombre: r.nombre, veces: r.veces };
    }
  }
  return memoria;
}

async function olvidarProveedor(hoja, clave, nombre) {
  await query(
    `DELETE FROM memoria_proveedor_nombre WHERE hoja = $1 AND clave = $2 AND nombre = $3`,
    [hoja, clave, nombre]
  );
}

async function registrarProveedor(hoja, clave, nombre) {
  await query(
    `INSERT INTO memoria_proveedor_nombre (hoja, clave, nombre, veces)
     VALUES ($1, $2, $3, 1)
     ON CONFLICT (hoja, clave, nombre) DO UPDATE SET veces = memoria_proveedor_nombre.veces + 1`,
    [hoja, clave, nombre]
  );
}

async function olvidarNota(hoja, clave, nota) {
  await query(
    `DELETE FROM memoria_proveedores WHERE hoja = $1 AND clave = $2 AND nota = $3`,
    [hoja, clave, (nota ?? '').trim()]
  );
}

let tablaRechazosAsegurada = false;
async function asegurarTablaRechazos() {
  if (tablaRechazosAsegurada) return;
  await query(`
    CREATE TABLE IF NOT EXISTS sugerencias_rechazadas (
      hoja TEXT NOT NULL,
      clave TEXT NOT NULL,
      tipo TEXT NOT NULL,
      valor TEXT NOT NULL DEFAULT '',
      creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (hoja, clave, tipo, valor)
    )`);
  tablaRechazosAsegurada = true;
}

async function registrarRechazo(hoja, clave, tipo, valor) {
  await asegurarTablaRechazos();
  await query(
    `INSERT INTO sugerencias_rechazadas (hoja, clave, tipo, valor)
     VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
    [hoja, clave, tipo, (valor ?? '').trim()]
  );
}

async function cargarRechazos() {
  await asegurarTablaRechazos();
  const { rows } = await query('SELECT hoja, clave, tipo, valor FROM sugerencias_rechazadas');
  const fuera = {};
  for (const r of rows) {
    fuera[r.hoja] = fuera[r.hoja] || {};
    fuera[r.hoja][r.clave] = fuera[r.hoja][r.clave] || {};
    fuera[r.hoja][r.clave][r.tipo] = fuera[r.hoja][r.clave][r.tipo] || new Set();
    fuera[r.hoja][r.clave][r.tipo].add(r.valor);
  }
  return fuera;
}

function estaRechazada(rechazos, hoja, clave, tipo, valor) {
  const s = rechazos?.[hoja]?.[clave]?.[tipo];
  return !!s && s.has((valor ?? '').trim());
}

module.exports = {
  cargarMemoria, registrarNota, cargarMemoriaProveedor, registrarProveedor,
  olvidarProveedor, olvidarNota,
  registrarRechazo, cargarRechazos, estaRechazada, asegurarTablaRechazos,
};
