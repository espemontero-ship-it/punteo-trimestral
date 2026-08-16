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

// Un número de factura es único de esa línea: aprenderlo no sirve de nada,
// porque no se va a repetir nunca. Antes se aprendían igual, y llegaron a
// ser 99 de los 152 patrones memorizados (ej. la clave de Strato tenía
// aprendidas las notas "31", "32", "33", "35"...) — ruido que competía con
// las respuestas de verdad. Se ignoran también las combinaciones tipo
// "4 + 44" o "59 y 60", que son varias facturas de la misma línea.
const SOLO_NUMEROS = /^[0-9]+(\s*(\+|y|,)\s*[0-9]+)*$/i;

// Registra una confirmación (línea o grupo) en la memoria — incrementa el contador
// si la combinación hoja+clave+nota ya existía.
// "Aquí no va nota" es una respuesta como cualquier otra, y se aprende igual.
// Antes solo se aprendía cuando escribías algo, así que resolver veinte líneas
// del mismo tipo dejándolas siempre en blanco no enseñaba nada: la app seguía
// tratándolas como si no las hubiera visto nunca. Ahora el vacío cuenta, y
// cuando sea la respuesta aprendida la app simplemente no propone nada.
// La nota vacía se guarda como cadena vacía, nunca como nulo: la columna no
// admite nulos.
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

// Memoria del nombre corto de Proveedor: mismo patrón que la de Nota, pero
// más simple — solo hace falta el nombre más usado por clave, no el conteo
// completo de alternativas.
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

// Al quitarle el proveedor a una línea, se borra también lo aprendido para
// ese tipo de movimiento. Sin esto, la línea se desagrupaba pero la app volvía
// a proponer el mismo nombre al momento siguiente: le decías que no y no se
// enteraba. (Si el nombre aparece literalmente en el texto del banco, se
// seguirá proponiendo por esa otra vía -- eso no es memoria, es lectura.)
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

// Rechazar una sugerencia de NOTA es borrar lo aprendido: esa sugerencia sale
// de las notas que la usuaria confirmó antes para ese tipo de movimiento, así
// que la única forma de que deje de proponerse es que la app la olvide.
async function olvidarNota(hoja, clave, nota) {
  await query(
    `DELETE FROM memoria_proveedores WHERE hoja = $1 AND clave = $2 AND nota = $3`,
    [hoja, clave, (nota ?? '').trim()]
  );
}

// Las sugerencias que NO salen de lo aprendido (proyecto, devolución, jugador)
// se calculan del texto del banco cada vez, así que no hay nada que olvidar:
// el rechazo hay que anotarlo. Se guarda por tipo de movimiento -- decir que
// no una vez vale para todas sus líneas, ahora y en el futuro.
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

// { [hoja]: { [clave]: { [tipo]: Set(valores) } } }
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
