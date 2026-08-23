// Herramientas comunes de las pruebas: sembrar datos de mentira, borrarlos, y
// un lector de facturas falso para no llamar a la IA de verdad.
//
// Todo lo sembrado lleva marca propia (la hoja "pruebas" y el nombre de archivo
// empezando por PRUEBA-) para poder borrarlo sin tocar nada más de la base de
// desarrollo.
import { query } from '../lib/db.cjs';
import { analizarFactura, procesarFacturaSubida } from '../lib/facturaMatcher.cjs';

export const MARCA = 'PRUEBA-';
export const HOJA = 'pruebas';

export async function limpiar() {
  await query(
    `DELETE FROM movimiento_facturas
      WHERE movimiento_id IN (SELECT id FROM movimientos WHERE hoja = $1)
         OR factura_id IN (SELECT id FROM facturas WHERE nombre_original LIKE $2)`,
    [HOJA, MARCA + '%']
  );
  await query(`DELETE FROM facturas WHERE nombre_original LIKE $1`, [MARCA + '%']);
  await query(`DELETE FROM movimientos WHERE hoja = $1`, [HOJA]);
  await query(`DELETE FROM lotes WHERE evento = 'LOTE DE PRUEBA'`);
}

// Una línea del banco de mentira. Por defecto pendiente, que es lo que hace
// falta para que el cruce la mire.
export async function sembrarLinea({ importe, fecha = '2026-07-20', concepto = 'LINEA DE PRUEBA', estado = 'sin_resolver' }) {
  const { rows } = await query(
    `INSERT INTO movimientos (hoja, fila, fecha, concepto, importe, clave, estado)
     VALUES ($1, floor(random() * 1000000)::int, $2, $3, $4, 'pruebas', $5)
     RETURNING id, importe, estado`,
    [HOJA, fecha, concepto, importe, estado]
  );
  return rows[0];
}

// Un lector que devuelve lo que se le diga, en vez de llamar a la IA.
export const lector = facturas => async () => ({ ok: true, facturas });
export const lectorRoto = error => async () => ({ ok: false, error });

// Sube una factura por el camino de verdad de la app, con el lector de mentira.
// `contenido` cambia en cada llamada para que la huella sea distinta; si no,
// la segunda subida se rechazaría por duplicada.
let contador = 0;
export async function subir({ leer, nombre, concepto = null, subidoPor = null, contenido = null }) {
  contador++;
  const archivo = nombre || `${MARCA}${contador}.pdf`;
  const analisis = await analizarFactura(
    Buffer.from(contenido || `${archivo}-${contador}-${Math.random()}`), true, archivo, leer
  );
  // Se sube con hoja/clave de pruebas para que el cruce mire SOLO las lineas
  // sembradas por la prueba. Sin esto, la busqueda recorre todos los
  // movimientos de la base de desarrollo y una linea real puede colarse como
  // candidata -- paso al ampliar el margen a un euro.
  const resultado = await procesarFacturaSubida({
    hoja: HOJA, clave: 'pruebas',
    rutaBlob: `https://ejemplo/${archivo}`, nombreOriginal: archivo, concepto, analisis, subidoPor,
  });
  return { resultado, archivo };
}

// La fecha se pide ya formateada por la base: convertirla en JavaScript mete
// el desfase de la zona horaria y la prueba compararia el dia anterior.
// Marca una factura como pagada por el colaborador: vive en su lote, que es lo
// unico que la distingue de las de la usuaria. El lote tiene que existir de
// verdad (la base lo exige), asi que se reutiliza uno o se crea uno de prueba.
export async function marcarComoDeLote(nombre) {
  const { rows } = await query(
    `SELECT l.id FROM lotes l WHERE l.evento = 'LOTE DE PRUEBA'
     UNION ALL SELECT id FROM lotes LIMIT 1`
  );
  let loteId = rows[0] && rows[0].id;
  if (!loteId) {
    const { rows: creado } = await query(
      `INSERT INTO lotes (trimestre_id, colaborador_id, evento, proyecto_id)
       VALUES ((SELECT id FROM trimestres LIMIT 1), (SELECT id FROM colaboradores LIMIT 1), 'LOTE DE PRUEBA', (SELECT id FROM proyectos LIMIT 1))
       RETURNING id`
    );
    loteId = creado[0].id;
  }
  await query('UPDATE facturas SET lote_id = $2 WHERE nombre_original = $1', [nombre, loteId]);
  return loteId;
}

export async function facturaPorNombre(nombre) {
  const { rows } = await query(
    `SELECT *, to_char(fechas[1], 'YYYY-MM-DD') AS fecha_texto FROM facturas WHERE nombre_original = $1`, [nombre]);
  return rows[0] || null;
}

export async function lineaPorId(id) {
  const { rows } = await query(`SELECT * FROM movimientos WHERE id = $1`, [id]);
  return rows[0] || null;
}
