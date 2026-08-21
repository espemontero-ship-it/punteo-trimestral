const crypto = require('crypto');
const { parse } = require('csv-parse/sync');
const { query } = require('./db.cjs');
const { listarProyectos, inferirProyecto } = require('./proyectos.cjs');

const TOLERANCIA = 0.01;

// Días entre una línea del banco y un pago. En valor absoluto a propósito: el
// desfase entre que se registra el pago y el banco lo apunta va en las dos
// direcciones, así que la cercanía cuenta igual antes que después.
function distanciaDias(a, b) {
  if (!a || !b) return 100000;   // sin fecha: asignable, pero la última
  return Math.abs(new Date(a) - new Date(b)) / 86400000;
}

// UN PAGO JUSTIFICA UNA SOLA LÍNEA DEL BANCO, Y UNA LÍNEA UN SOLO PAGO.
//
// Vive aquí, en un único sitio, porque hay DOS pantallas que responden a la
// misma pregunta: el cruce al subir el archivo, y la lista de "Pagos sin
// emparejar". Cada una lo calculaba por su cuenta, así que la lista decía
// "encaja con 2 líneas, elige cuál" de cosas que el cruce ya había decidido
// solo. Dos implementaciones de la misma regla siempre acaban discrepando.
//
// El reparto no se hace línea a línea sino de una vez: se forman todas las
// parejas posibles (mismo apellido y mismo importe exacto), se ordenan por
// cercanía de fecha y se asignan de la más cercana a la más lejana, saltando
// las que ya tienen pareja.
// `rechazados` son los pares pago–movimiento que la usuaria ya ha rechazado
// con la ✕. No se vuelven a proponer nunca: rechazar no es "ahora no", es
// "este movimiento no es de esta persona". Y como el reparto sigue buscando,
// rechazar una propuesta hace que salga la siguiente mejor en vez de dejar el
// pago sin nada.
function repartirUnoAUno(lineas, pagos, rechazados = new Set()) {
  const parejas = [];
  for (const l of lineas) {
    const palabrasLinea = new Set(String(l.n || '').split(' ').filter(Boolean));
    for (const p of pagos) {
      if (rechazados.has(`${p.clave}|${l.id}`)) continue;
      // Encaja por el apellido, o por cómo el banco llama a esa persona si ya
      // se aprendió al vincular a mano (ver aprenderComoLlamaElBanco).
      const porAlias = (p.alias || []).some(w => palabrasLinea.has(w));
      if (!porAlias && !tokensCoinciden(p.variantes, l.n)) continue;
      if (Math.abs(Number(p.importe) - Number(l.importe)) > TOLERANCIA) continue;
      parejas.push({ l, p, dist: distanciaDias(l.fecha, p.fecha) });
    }
  }
  parejas.sort((a, b) => a.dist - b.dist);
  const porLinea = new Map();   // id de línea  -> pago
  const porPago = new Map();    // clave de pago -> línea
  for (const { l, p } of parejas) {
    if (porLinea.has(l.id) || porPago.has(p.clave)) continue;
    porLinea.set(l.id, p);
    porPago.set(p.clave, l);
  }
  return { porLinea, porPago };
}

// Igual que asegurarColumnasMotivo en facturaMatcher.cjs: ALTER TABLE ... ADD
// COLUMN IF NOT EXISTS es barato e idempotente, se ejecuta como mucho una
// vez por arranque en frío. La columna guarda el resultado del cruce
// (tipo + candidatos, con su proyecto sugerido) de forma que el botón de
// confirmar se pueda pintar SIEMPRE a partir de lo guardado en la fila, no
// solo justo después de subir el CSV -- si dependiera de un estado que solo
// vive en el navegador mientras dura esa sesión, al recargar la página o
// volver más tarde el botón desaparecería aunque el cruce ya se hubiera
// hecho, y habría que volver a subir el mismo CSV para nada.
let columnaLarpManagerAsegurada = false;
async function asegurarColumnaLarpManager() {
  if (columnaLarpManagerAsegurada) return;
  await query(`ALTER TABLE movimientos ADD COLUMN IF NOT EXISTS larpmanager_candidatos JSONB`);
  columnaLarpManagerAsegurada = true;
}

// Cómo llama el banco a cada jugador, aprendido al vincular a mano.
//
// El cruce compara el apellido de LarpManager contra el texto del banco, y hay
// nombres que no van a coincidir nunca: el banco escribe "Greer Matthias Rola"
// donde LarpManager pone "Matthias Greßer" -- se come la ß en vez de
// convertirla en ss. Hasta ahora eso obligaba a vincular a mano los cuatro
// pagos de esa persona, uno por uno, cada vez. La app ya aprende el proveedor
// de una línea y no vuelve a preguntar; esto es lo mismo para los jugadores.
let tablaAliasAsegurada = false;
async function asegurarTablaAlias() {
  if (tablaAliasAsegurada) return;
  await query(`
    CREATE TABLE IF NOT EXISTS larpmanager_alias (
      nombre TEXT NOT NULL,
      palabra TEXT NOT NULL,
      PRIMARY KEY (nombre, palabra)
    )
  `);
  tablaAliasAsegurada = true;
}

// UNA SOLA REGLA: se aprenden las palabras PEGADAS A SU NOMBRE dentro del
// texto del movimiento. Nada más.
//
// Antes había dos métodos y daban resultados distintos con el mismo enlace:
// si el movimiento traía la columna del ordenante se aprendía de ahí tal
// cual, y si no, se rebuscaba en la línea entera quedándose con las palabras
// que salieran en 6 movimientos o menos. Ahora la columna del ordenante no es
// un método aparte -- es simplemente más texto donde buscar, si está.
//
// El anclaje es lo que hace que funcione sin adivinar: el banco escribe el
// nombre de quien paga como un bloque de palabras seguidas ("ANTON VIEJO
// ALONSO", "Miss Samantha Alexine Van Den Ess", "Greer Matthias Rola") y el
// resto de la línea es papeleo -- "Registration fee 2", "ticket 2027",
// referencias de operación. Mirando solo alrededor de su nombre se aprende
// VIEJO y ALONSO, no Registration ni 2027.
const VECINAS = 2;

// Aun pegada a su nombre, una palabra puede no identificar a nadie:
//   - Tratamientos: el banco los escribe justo delante. Aprender "MISS" para
//     alguien le entrega cualquier otra línea que también lo lleve -- pasó en
//     producción, el pago de Valeria Oliveira se quedó el ingreso de Samantha
//     van den Esschert por esto exactamente.
//   - El nombre de OTRO jugador: dice que la línea es de la otra persona, no
//     cómo llama el banco a esta. Así se aprendió "SAMANTHA" para Valeria.
//   - El nombre de un evento: se lo llevaría cualquier otro pago del mismo.
//   - Cualquier cosa con dígitos: IBANs y referencias de operación, únicas de
//     cada transferencia y por tanto inútiles. Y las palabras larguísimas,
//     que son esas mismas referencias cuando vienen sin ningún número
//     ("IZWIULOCOMFFGSJI"). El apellido más largo de la lista real tiene 13
//     letras (KORTTEENNIEMI), así que el corte en 14 no deja fuera a nadie.
//   - Y las que salen por toda la lista: "TRANSFERENCIAS" puede estar pegada
//     a su nombre y no es de nadie. El anclaje ya deja fuera casi todo, esto
//     solo cubre lo que queda justo al lado.
const TRATAMIENTOS = new Set(['MISS', 'MRS', 'MISTER', 'MADAME', 'MADEMOISELLE', 'HERR', 'FRAU', 'DON', 'DONA', 'SENOR', 'SENORA']);
const APARICIONES_MAX = 6;
const LETRAS_MAX = 14;

async function palabrasQueNoIdentifican(nombreJugador) {
  const suyo = normalizarVariantes(nombreJugador)[0];
  const { rows } = await query(`SELECT DISTINCT nombre_real, evento FROM larpmanager_pagos`);
  const fuera = new Set();
  for (const r of rows) {
    const variantes = normalizarVariantes(r.nombre_real);
    if (!variantes.includes(suyo)) {
      for (const v of variantes) for (const w of v.split(' ')) if (w.length >= 3) fuera.add(w);
    }
    for (const w of normalizar(r.evento || '').split(' ')) if (w.length >= 3) fuera.add(w);
  }
  // Lo que está en su propio nombre no es de nadie más ni es un evento.
  for (const v of normalizarVariantes(nombreJugador)) for (const w of v.split(' ')) fuera.delete(w);
  return fuera;
}

async function aprenderComoLlamaElBanco(nombreJugador, concepto, ordenante) {
  await asegurarTablaAlias();

  const palabras = normalizar(`${concepto || ''} ${ordenante || ''}`).split(' ').filter(Boolean);
  const suyas = new Set(normalizarVariantes(nombreJugador).flatMap(v => v.split(' ')).filter(w => w.length >= 3));
  const anclas = palabras.map((w, i) => (suyas.has(w) ? i : -1)).filter(i => i >= 0);
  // Si su nombre no aparece por ningún lado no hay de dónde aprender. Mejor
  // no aprender nada que inventar una regla a partir de un texto que no la
  // menciona.
  if (anclas.length === 0) return 0;

  const candidatas = new Set();
  for (const i of anclas) {
    for (let j = Math.max(0, i - VECINAS); j <= Math.min(palabras.length - 1, i + VECINAS); j++) {
      const w = palabras[j];
      if (w.length < 3 || w.length > LETRAS_MAX || suyas.has(w) || /[0-9]/.test(w) || TRATAMIENTOS.has(w)) continue;
      candidatas.add(w);
    }
  }
  if (candidatas.size === 0) return 0;

  const fuera = await palabrasQueNoIdentifican(nombreJugador);
  const { rows: movs } = await query(`SELECT concepto FROM movimientos`);
  const frecuencia = new Map();
  for (const m of movs) {
    for (const w of new Set(normalizar(m.concepto).split(' '))) frecuencia.set(w, (frecuencia.get(w) || 0) + 1);
  }

  const utiles = [...candidatas].filter(w => !fuera.has(w) && (frecuencia.get(w) || 0) <= APARICIONES_MAX);
  if (utiles.length === 0) return 0;

  const nombre = normalizarVariantes(nombreJugador)[0];
  for (const w of utiles) {
    await query(
      `INSERT INTO larpmanager_alias (nombre, palabra) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [nombre, w]
    );
  }
  return utiles.length;
}

// Sugerencias rechazadas con la ✕, guardadas para siempre. Se guarda el PAR
// (pago, movimiento), no el pago: decir que no a una propuesta no es decir
// que ese pago no tenga movimiento, es decir que no es ese.
let tablaRechazosAsegurada = false;
async function asegurarTablaRechazosLarpManager() {
  if (tablaRechazosAsegurada) return;
  await query(`
    CREATE TABLE IF NOT EXISTS larpmanager_rechazos (
      pago_id BIGINT NOT NULL REFERENCES larpmanager_pagos(id) ON DELETE CASCADE,
      movimiento_id BIGINT NOT NULL REFERENCES movimientos(id) ON DELETE CASCADE,
      PRIMARY KEY (pago_id, movimiento_id)
    )
  `);
  tablaRechazosAsegurada = true;
}

async function cargarRechazosLarpManager() {
  await asegurarTablaRechazosLarpManager();
  const { rows } = await query(`SELECT pago_id, movimiento_id FROM larpmanager_rechazos`);
  return new Set(rows.map(r => `${r.pago_id}|${r.movimiento_id}`));
}

// El mismo conjunto, pero con la clave que usa el cruce al subir el archivo:
// allí un pago se identifica por su firma+orden, no por su id, porque se
// trabaja con las filas del archivo antes de mirar la base.
async function cargarRechazosPorFirma() {
  await asegurarTablaRechazosLarpManager();
  const { rows } = await query(
    `SELECT p.firma, p.orden, r.movimiento_id
     FROM larpmanager_rechazos r JOIN larpmanager_pagos p ON p.id = r.pago_id
     WHERE p.firma IS NOT NULL`
  );
  return new Set(rows.map(r => `${r.firma}|${r.orden}|${r.movimiento_id}`));
}

async function rechazarSugerenciaLarpManager(pagoId, movimientoId) {
  await asegurarTablaRechazosLarpManager();
  await query(
    `INSERT INTO larpmanager_rechazos (pago_id, movimiento_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
    [pagoId, movimientoId]
  );
  return { ok: true };
}

async function cargarAlias() {
  await asegurarTablaAlias();
  const { rows } = await query(`SELECT nombre, palabra FROM larpmanager_alias`);
  const mapa = new Map();
  for (const r of rows) {
    if (!mapa.has(r.nombre)) mapa.set(r.nombre, []);
    mapa.get(r.nombre).push(r.palabra);
  }
  return mapa;
}

// Guarda cada pago Wire (+ "manual") del CSV como una fila propia, con
// movimiento_id NULL hasta que se confirma a qué línea del banco
// corresponde -- así se puede preguntar en cualquier momento "¿qué pagos de
// LarpManager siguen sin encontrar su línea del banco?" sin depender de
// nada que solo viva en el navegador justo después de subir el CSV. No
// pertenecen a ningún trimestre -- el CSV es acumulativo y se cruza contra
// todo el histórico de ingresos sin resolver.
let tablaPagosAsegurada = false;
async function asegurarTablaPagosLarpManager() {
  if (tablaPagosAsegurada) return;
  await query(`
    CREATE TABLE IF NOT EXISTS larpmanager_pagos (
      id BIGSERIAL PRIMARY KEY,
      nombre_real TEXT NOT NULL,
      evento TEXT,
      importe NUMERIC(12,2) NOT NULL,
      fecha DATE,
      movimiento_id BIGINT REFERENCES movimientos(id) ON DELETE SET NULL,
      creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  // Ver db/migration_importaciones_larpmanager.sql para el porqué de cada una.
  await query(`ALTER TABLE importaciones ADD COLUMN IF NOT EXISTS origen TEXT NOT NULL DEFAULT 'banco'`);
  await query(`ALTER TABLE larpmanager_pagos ADD COLUMN IF NOT EXISTS importacion_id BIGINT REFERENCES importaciones(id) ON DELETE SET NULL`);
  await query(`ALTER TABLE larpmanager_pagos ADD COLUMN IF NOT EXISTS datos_originales JSONB`);
  await query(`ALTER TABLE larpmanager_pagos ADD COLUMN IF NOT EXISTS entra_en_cruce BOOLEAN NOT NULL DEFAULT true`);
  await query(`ALTER TABLE larpmanager_pagos ADD COLUMN IF NOT EXISTS firma TEXT`);
  await query(`ALTER TABLE larpmanager_pagos ADD COLUMN IF NOT EXISTS orden INT NOT NULL DEFAULT 0`);
  // Mismo vocabulario que `movimientos`: 'pendiente' / 'resuelta' / 'ignorada'.
  // Existe para poder quitar un pago de la lista sin borrarlo. Borrarlo no
  // servía: una fila se reconoce por su firma, así que al volver a subir el
  // mismo export la fila borrada ya no estaría y entraría otra vez -- había
  // que borrar el archivo entero y subir uno recortado.
  await query(`ALTER TABLE larpmanager_pagos ADD COLUMN IF NOT EXISTS estado TEXT NOT NULL DEFAULT 'pendiente'`);
  // Un pago con línea del banco está resuelto por definición. Se fuerza aquí
  // porque los que ya estaban vinculados antes de existir esta columna se
  // quedaron con el valor por defecto.
  await query(`UPDATE larpmanager_pagos SET estado = 'resuelta' WHERE movimiento_id IS NOT NULL AND estado = 'pendiente'`);
  await query(`CREATE INDEX IF NOT EXISTS idx_larpmanager_pagos_importacion ON larpmanager_pagos(importacion_id)`);
  await query(`DROP INDEX IF EXISTS larpmanager_pagos_natural_key`);
  await query(`CREATE UNIQUE INDEX IF NOT EXISTS larpmanager_pagos_firma_key ON larpmanager_pagos(firma, orden)`);
  tablaPagosAsegurada = true;
}

// No reemplaza lo ya guardado (ON CONFLICT DO NOTHING): si un pago ya estaba
// vinculado a una línea del banco de una subida anterior, volver a subir el
// mismo CSV no debe desvincularlo.
//
// Un INSERT por fila (1124 filas en el export real) tarda demasiado contra
// una base de datos remota -- de sobra para superar el límite de una
// función serverless. Se hace en una sola sentencia con todas las filas a
// la vez en vez de una consulta por fila.
async function guardarPagosLarpManager(filasCSV, importacionId) {
  await asegurarTablaPagosLarpManager();
  if (filasCSV.length === 0) return;

  const CAMPOS = 8;
  const placeholders = [];
  const valores = [];
  filasCSV.forEach((f, i) => {
    const base = i * CAMPOS;
    placeholders.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8})`);
    valores.push(
      f.nombreReal || '(sin nombre)',
      f.evento,
      isNaN(f.importe) ? 0 : f.importe,
      f.fecha ? f.fecha.toISOString().slice(0, 10) : null,
      JSON.stringify(f.datosOriginales),
      f.entraEnCruce,
      f.firma,
      f.orden,
    );
  });

  // Volver a subir el mismo CSV no duplica ni desvincula: una fila ya guardada
  // se reconoce por su firma y se deja como está, con su enlace a la línea del
  // banco si ya lo tenía.
  await query(
    `INSERT INTO larpmanager_pagos
       (nombre_real, evento, importe, fecha, datos_originales, entra_en_cruce, firma, orden)
     VALUES ${placeholders.join(', ')}
     ON CONFLICT (firma, orden) DO NOTHING`,
    valores
  );

  if (importacionId) {
    // Solo se marca la procedencia de las filas que no la tuvieran: si una ya
    // vino en una subida anterior, esa sigue siendo su subida de origen.
    const firmas = filasCSV.map(f => f.firma);
    await query(
      `UPDATE larpmanager_pagos SET importacion_id = $1
       WHERE importacion_id IS NULL AND firma = ANY($2::text[])`,
      [importacionId, firmas]
    );
  }
}

// Todos los pagos de LarpManager que ningún movimiento del banco ha
// reclamado todavía -- el hueco que antes no se podía ver: si LarpManager
// dice que alguien pagó pero esa transferencia nunca aparece emparejada,
// aquí se queda listada para revisar a mano.
async function listarPagosLarpManagerSinEmparejar() {
  await asegurarTablaPagosLarpManager();

  // Se cruza al abrir la lista. El cruce vivía solo dentro de la subida
  // porque al principio los pagos no se guardaban, así que sin el archivo
  // delante no había con qué cruzar. Desde que se guardan todos, esa atadura
  // no tiene sentido: la lista decía "le corresponde la línea X, vuelve a
  // subir el archivo y se cerrará solo" -- mandaba a repetir una subida para
  // que la app hiciera algo que ya podía hacer con lo que tenía.
  //
  // EL CRUCE PROPONE, NO ESCRIBE. Durante unas horas sí escribió: al abrir la
  // pestaña se enlazaba todo lo que encajara, sin preguntar. Dos cosas se
  // rompieron por eso, las dos vistas en producción:
  //
  //   - Un acierto falso se cerraba solo y en silencio. El pago de 150 € de
  //     Nitzan Alon se quedó con el ingreso de Antón Viejo Alonso, y quedaba
  //     como cobrado un dinero que no había llegado.
  //   - Peor: enlazar a mano ENSEÑA cómo llama el banco a esa persona (ver
  //     aprenderComoLlamaElBanco), y el camino automático reutilizaba esa
  //     misma función. Así que cada acierto falso se convertía en regla. El
  //     pago de Valeria Oliveira se quedó el ingreso de Samantha van den
  //     Esschert --las dos líneas ponen "Miss"-- y de ahí la app aprendió que
  //     "SAMANTHA" es como el banco llama a Valeria.
  //
  // Aprender solo tiene sentido cuando lo dice la usuaria. Así que aquí se
  // calcula la propuesta y se devuelve con el pago, y quien la acepta es
  // ella, con la píldora de sugerencia de la columna Movimiento -- el mismo
  // gesto que para el proveedor, la nota o el proyecto en Movimientos.
  // Solo los que TENÍAN que cruzarse. Un pago de Stripe o de Redsys, o un
  // apunte interno (larpmoney, larpmanager), no llega al banco como línea
  // propia: nunca va a tener movimiento, así que listarlo aquí es decir que
  // falta algo que no falta. Antes esta condición no hacía falta porque esas
  // filas ni se guardaban; al pasar a guardarlas todas se coló entera la
  // lista de las que no se cruzan -- 43 de 49 en la primera subida real.
  // Salen los tres estados, no solo los pendientes: esconder los ignorados
  // aquí dejaría la única forma de deshacer un "ignorar" fuera de la pantalla
  // donde se ignoró. Es la casilla "Solo pendientes" la que los oculta, igual
  // que en Movimientos.
  // Salen los cuatro casos, no solo lo que falta: pendiente, ignorado a mano,
  // dado por bueno a mano y emparejado con su línea. Esconder aquí lo ya
  // contestado dejaba la única forma de deshacerlo fuera de la pantalla donde
  // se hizo, y no había ningún sitio donde ver de un vistazo qué pagos SÍ
  // habían cuadrado. Es la casilla "Solo pendientes" la que los oculta, igual
  // que en Movimientos.
  const { rows } = await query(
    `SELECT p.id, p.nombre_real, p.evento, p.importe, p.fecha, p.estado,
            m.id AS movimiento_id, m.fecha AS movimiento_fecha,
            m.importe AS movimiento_importe, m.concepto AS movimiento_concepto
     FROM larpmanager_pagos p
     LEFT JOIN movimientos m ON m.id = p.movimiento_id
     WHERE p.entra_en_cruce
     ORDER BY p.fecha DESC NULLS LAST, p.nombre_real`
  );
  if (rows.length === 0) return rows;

  // Por qué no se emparejó cada uno. Antes esta lista no decía nada: un pago
  // aparecía ahí igual si la transferencia no había llegado, si el importe
  // no cuadraba o si el nombre coincidía a medias, y no había forma de
  // distinguirlo. Se calcula al vuelo contra los movimientos de hoy (no se
  // guarda) para que el motivo refleje siempre el estado actual del banco y
  // no el del día en que se subió el CSV.
  // TODAS las líneas de ingreso, también las que ya justifican un pago, y de
  // quién es ese pago. Antes se pedían solo las libres y por eso el "Por qué"
  // mentía: a un pago cuya línea se había quedado otro pago suyo le decía "el
  // nombre no aparece en ninguna línea del banco" -- aparecía, y estaba
  // cogida, que es una situación completamente distinta y con otra respuesta.
  const { rows: movimientos } = await query(
    `SELECT m.id, m.concepto, m.importe, m.fecha,
            lp.nombre_real AS ocupada_por, lp.fecha AS ocupada_fecha
     FROM movimientos m
     LEFT JOIN larpmanager_pagos lp ON lp.movimiento_id = m.id
     WHERE m.importe > 0`
  );
  const conceptos = movimientos.map(m => ({
    id: m.id, importe: Number(m.importe), fecha: m.fecha, concepto: m.concepto, n: normalizar(m.concepto),
    ocupadaPor: m.ocupada_por ? { nombre: m.ocupada_por, fecha: m.ocupada_fecha } : null,
  }));
  // El reparto solo puede repartir lo que está libre: las ocupadas entran en
  // esta función para explicar, no para proponerse.
  const libres = conceptos.filter(c => !c.ocupadaPor);

  // El MISMO reparto que hace el cruce al subir el archivo: si aquí se
  // calculara aparte, la lista diría "elige cuál" de pagos que el cruce ya
  // habría cerrado solo.
  // Solo los pendientes entran en el reparto: un pago ignorado o dado por
  // resuelto a mano no debe quedarse con una línea del banco que le hace
  // falta a otro pago de la misma persona.
  const alias = await cargarAlias();
  const rechazados = await cargarRechazosLarpManager();
  const { porPago } = repartirUnoAUno(libres, rows.filter(p => p.estado === 'pendiente').map(p => ({
    clave: p.id, importe: p.importe, fecha: p.fecha, variantes: normalizarVariantes(p.nombre_real),
    alias: alias.get(normalizarVariantes(p.nombre_real)[0]) || [],
  })), rechazados);
  // Cuántos días tarda el banco en apuntarlo. El desfase es normal --el dinero
  // tarda días en llegar-- y es lo que decide entre dos movimientos iguales.
  const desfase = (fBanco, fPago) => {
    if (!fBanco || !fPago) return null;
    return Math.round((new Date(fBanco) - new Date(fPago)) / 86400000);
  };
  // Más cerca en fecha primero: es el que con más probabilidad es el bueno.
  const porCercania = (fPago) => (a, b) =>
    Math.abs(desfase(a.fecha, fPago) ?? 9999) - Math.abs(desfase(b.fecha, fPago) ?? 9999);

  // Una propuesta CON DUDAS. Cuando el cruce no está seguro --el banco solo
  // escribe parte del nombre, o el importe no cuadra-- antes no se ofrecía
  // nada y había que buscar a mano entre todos los ingresos, aunque el propio
  // "Por qué" acabara de nombrar el movimiento sospechoso. Ahora se ofrece
  // uno, el más cercano en fecha, marcado como dudoso para que no se pueda
  // confundir con una propuesta firme (ver .sugerencia.dudosa en globals.css).
  //
  // Solo se ofrecen movimientos LIBRES y que no esté proponiendo ya otro
  // pago: proponer uno que ya tiene dueño es proponer un duplicado. Por eso
  // el caso "hay movimientos suyos pero ya se los ha pedido otro pago suyo"
  // se queda sin propuesta -- ahí, por definición, no queda ninguno libre.
  const comprometidos = new Set([...porPago.values()].map(m => m.id));
  const proponerDudosa = (candidatas, p) => {
    const libre = candidatas
      .filter(m => !m.ocupadaPor && !comprometidos.has(m.id) && !rechazados.has(`${p.id}|${m.id}`))
      .sort(porCercania(p.fecha))[0];
    if (!libre) return null;
    comprometidos.add(libre.id);
    return {
      movimientoId: libre.id, fecha: libre.fecha, importe: libre.importe,
      concepto: libre.concepto || '', dias: desfase(libre.fecha, p.fecha), dudosa: true,
    };
  };

  return rows.map(p => {
    // Ya tiene su línea: lo que hace falta saber es cuál, no por qué no la
    // encuentra.
    if (p.movimiento_id) {
      return {
        ...p, motivo: 'emparejado',
        motivoTexto: 'Emparejado',
      };
    }
    // A un pago que ya has contestado no se le busca explicación: no está
    // esperando nada.
    if (p.estado === 'ignorada') {
      return { ...p, motivo: 'ignorada', motivoTexto: 'Ignorado a mano' };
    }
    if (p.estado === 'resuelta') {
      return { ...p, motivo: 'resuelta_a_mano', motivoTexto: 'Dado por bueno a mano' };
    }

    const variantes = normalizarVariantes(p.nombre_real);
    const porApellido = conceptos.filter(m => tokensCoinciden(variantes, m.n));

    // La línea que le ha tocado en el reparto. Es UNA, no una lista de
    // candidatas: la ambigüedad la resuelve la fecha, no la usuaria.
    const suya = porPago.get(p.id);
    if (suya) {
      return {
        ...p, motivo: 'sin_confirmar',
        // La propuesta viaja como dato, no solo dentro de la frase: la
        // columna Movimiento la pinta como píldora de sugerencia y aceptarla
        // es lo que la escribe.
        sugerencia: {
          movimientoId: suya.id, fecha: suya.fecha, importe: suya.importe,
          concepto: suya.concepto || '', dias: desfase(suya.fecha, p.fecha),
        },
        motivoTexto: 'Ok',
      };
    }

    if (porApellido.length > 0) {
      const cuadran = porApellido.filter(m => Math.abs(m.importe - Number(p.importe)) <= TOLERANCIA);
      if (cuadran.length === 0) {
        return {
          ...p, motivo: 'importe_no_cuadra', sugerencia: proponerDudosa(porApellido, p),
          motivoTexto: 'El importe no cuadra',
        };
      }
      // Su nombre y su importe encajan, pero los movimientos ya están dados:
      // o se los han quedado otros pagos suyos más cercanos en fecha, o son de
      // otra persona a la que el banco escribe parecido. No hay propuesta que
      // hacer -- proponerDudosa solo ofrece libres, y aquí no queda ninguno.
      return { ...p, motivo: 'sin_linea_libre', motivoTexto: 'Sin movimiento libre' };
    }

    const parciales = conceptos.filter(m => coincidenciaParcial(variantes, m.n));
    if (parciales.length > 0) {
      return {
        ...p, motivo: 'nombre_parcial', sugerencia: proponerDudosa(parciales, p),
        motivoTexto: 'Solo coincide parte del nombre',
      };
    }

    return {
      ...p, motivo: 'no_esta',
      motivoTexto: 'No aparece en el banco',
    };
  });
}

// Cierra un pago de LarpManager contra su línea del banco sin tocar la
// línea. Se usa cuando el movimiento ya estaba resuelto y por tanto no hay
// nada que confirmar en pantalla: lo único que faltaba era el enlace.
async function enlazarPagoConMovimiento(movimientoId, candidato) {
  const fecha = candidato.fecha ? candidato.fecha.toISOString().slice(0, 10) : null;
  const { rowCount } = await query(
    `UPDATE larpmanager_pagos SET movimiento_id = $1, estado = 'resuelta'
     WHERE movimiento_id IS NULL AND estado = 'pendiente' AND nombre_real = $2 AND importe = $3
       AND (fecha = $4::date OR ($4::date IS NULL AND fecha IS NULL))`,
    [movimientoId, candidato.nombreReal, candidato.importe, fecha]
  );
  return rowCount > 0;
}

// Líneas del banco que podrían ser de este pago, para poder elegir a mano
// cuando el cruce automático no encuentra nada. Existe porque hay casos que
// el cruce NUNCA va a resolver: el banco a veces no escribe el nombre en el
// concepto ("ABONO POR TRANSFERENCIA A SU FAVOR RECIBIDA EN EUROS LIQ. OP.
// Nº 000"), y sin nombre no hay nada que comparar.
//
// No se puede reutilizar /api/movimientos-pendientes (el que usa Facturas):
// ese filtra por estado, y aquí la mayoría de los candidatos están YA
// resueltos —se puntean a mano antes de subir el CSV— así que se quedarían
// fuera justo los que hacen falta. De 51 ingresos reales, 43 están resueltos.
async function listarCandidatosParaPago(pagoId) {
  await asegurarTablaPagosLarpManager();
  const { rows: pagos } = await query(
    `SELECT id, nombre_real, evento, importe, fecha FROM larpmanager_pagos WHERE id = $1`,
    [pagoId]
  );
  if (pagos.length === 0) throw new Error('Pago no encontrado.');
  const pago = pagos[0];

  // Solo ingresos, y solo los que no ha reclamado ya otro pago: ofrecer una
  // línea que ya es de otra persona solo sirve para equivocarse.
  //
  // Fuera las marcadas como Stripe: son las liquidaciones de la pasarela (un
  // solo ingreso que agrupa muchas inscripciones), no la transferencia de una
  // persona, así que nunca son lo que se busca aquí. Son 9 de las 25 en
  // producción. NO se filtra por estado: lo normal es que la línea YA esté
  // resuelta, porque las transferencias se puntean a mano antes de subir el
  // CSV -- 17 de esas 25 lo están. Filtrar por estado dejaría fuera justo las
  // que hacen falta.
  const { rows } = await query(
    `SELECT m.id, m.fecha, m.concepto, m.importe, m.estado, m.hoja
     FROM movimientos m
     WHERE m.importe > 0
       AND LOWER(COALESCE(m.proveedor, '')) <> 'stripe'
       AND NOT EXISTS (SELECT 1 FROM larpmanager_pagos p WHERE p.movimiento_id = m.id)
     ORDER BY m.fecha DESC NULLS LAST`
  );

  // El importe es la señal fuerte: se marcan los que cuadran para poder
  // enseñarlos primero y aparte. Con el caso real de Omer (160€), esto deja
  // un único candidato de 25.
  const dia = f => (f ? new Date(f).getTime() : null);
  const fechaPago = dia(pago.fecha);
  // Las líneas que llevan su nombre dentro son las que hay que ofrecerle
  // primero: son exactamente las que la columna "Por qué" nombra cuando dice
  // "coincide parte del nombre en 4 líneas". Antes se ordenaba solo por
  // importe, así que la lista de candidatas no tenía nada que ver con las
  // que se le acababan de nombrar, y había que buscarlas a ojo entre todas.
  const variantes = normalizarVariantes(pago.nombre_real);
  const llevaSuNombre = concepto => {
    const pal = new Set(normalizar(concepto).split(' ').filter(Boolean));
    return variantes.some(v => v.split(' ').filter(t => t.length >= 4).some(t => pal.has(t)));
  };
  return rows
    .map(m => ({
      id: m.id,
      fecha: m.fecha,
      concepto: m.concepto,
      importe: Number(m.importe),
      estado: m.estado,
      hoja: m.hoja,
      mismoImporte: Math.abs(Number(m.importe) - Number(pago.importe)) <= TOLERANCIA,
      suNombre: llevaSuNombre(m.concepto),
      diasDeDiferencia: fechaPago && dia(m.fecha) !== null
        ? Math.round(Math.abs(dia(m.fecha) - fechaPago) / 86400000)
        : null,
    }))
    // Orden: las que llevan su nombre antes que nada, luego las del mismo
    // importe, y dentro de cada bloque las más cercanas en fecha.
    .sort((a, b) => {
      if (a.suNombre !== b.suNombre) return a.suNombre ? -1 : 1;
      if (a.mismoImporte !== b.mismoImporte) return a.mismoImporte ? -1 : 1;
      const da = a.diasDeDiferencia ?? 9999, db = b.diasDeDiferencia ?? 9999;
      return da - db;
    });
}

// Todos los pagos de esa persona en LarpManager, con la línea del banco que
// le tocó a cada uno. Se enseña al abrir un pago para vincularlo: cuando la
// app dice "el nombre no aparece en ninguna línea", lo único que permite
// decidir es ver el resto de sus pagos -- que tiene cuatro, que tres
// cuadraron y que este falta, o que ese dinero entró por larpmoney y no va a
// estar nunca en el banco.
//
// Salen TODOS, también los que no entran en el cruce (larpmoney, pasarelas):
// esos no aparecen en ninguna otra pantalla de la aplicación, y son justo los
// que explican por qué a alguien le faltan líneas.
async function historialDeJugador(pagoId) {
  await asegurarTablaPagosLarpManager();
  const { rows: pagos } = await query(
    `SELECT nombre_real FROM larpmanager_pagos WHERE id = $1`, [pagoId]
  );
  if (pagos.length === 0) throw new Error('Pago no encontrado.');

  const { rows } = await query(
    `SELECT p.id, p.evento, p.importe, p.fecha, p.estado, p.entra_en_cruce,
            p.datos_originales->>'Method' AS metodo,
            p.datos_originales->>'Info'   AS info,
            m.id AS movimiento_id, m.fecha AS movimiento_fecha,
            m.importe AS movimiento_importe, m.concepto AS movimiento_concepto
     FROM larpmanager_pagos p
     LEFT JOIN movimientos m ON m.id = p.movimiento_id
     WHERE p.nombre_real = $1
     ORDER BY p.fecha NULLS LAST, p.id`,
    [pagos[0].nombre_real]
  );

  return rows.map(r => {
    const via = (r.metodo || r.info || '').trim();
    let nota = null;
    if (!r.movimiento_id) {
      if (!r.entra_en_cruce) nota = via ? `No pasa por el banco (${via})` : 'No pasa por el banco';
      else if (r.estado === 'ignorada') nota = 'Ignorado a mano';
      else if (r.estado === 'resuelta') nota = 'Dado por bueno a mano, sin movimiento';
      else nota = 'Sin emparejar';
    }
    return {
      id: r.id,
      evento: r.evento,
      importe: Number(r.importe),
      fecha: r.fecha,
      estado: r.estado,
      nota,
      movimiento: r.movimiento_id
        ? { id: r.movimiento_id, fecha: r.movimiento_fecha, importe: Number(r.movimiento_importe), concepto: r.movimiento_concepto }
        : null,
    };
  });
}

// Pendiente / resuelta / ignorada, el mismo vocabulario que `movimientos`.
// Solo tiene sentido en un pago sin línea del banco: uno que la tiene está
// resuelto porque lo dice el dinero, no porque alguien lo haya elegido.
async function cambiarEstadoPago(pagoId, estado) {
  await asegurarTablaPagosLarpManager();
  if (!['pendiente', 'resuelta', 'ignorada'].includes(estado)) {
    throw new Error('Estado no válido.');
  }
  const { rows } = await query(
    `SELECT movimiento_id FROM larpmanager_pagos WHERE id = $1`, [pagoId]
  );
  if (rows.length === 0) throw new Error('Pago no encontrado.');
  if (rows[0].movimiento_id) {
    throw new Error('Ese pago ya tiene movimiento: quítale el vínculo antes de cambiarle el estado.');
  }
  await query(`UPDATE larpmanager_pagos SET estado = $1 WHERE id = $2`, [estado, pagoId]);
  return { estado };
}

// La vista inversa de listarCandidatosParaPago: allí se elige el movimiento de
// un pago; aquí, el pago de un movimiento. Hace falta porque desde Movimientos
// no había forma de enlazar, solo de deshacer -- y es justo donde se ve el
// caso: una transferencia que el banco describe como "Registration fee 2 of
// Calum", sin apellido, que el cruce no va a encontrar nunca solo.
async function listarPagosCandidatosParaMovimiento(movimientoId) {
  await asegurarTablaPagosLarpManager();
  const { rows: movs } = await query(
    `SELECT id, fecha, importe, concepto FROM movimientos WHERE id = $1`, [movimientoId]
  );
  if (movs.length === 0) throw new Error('Movimiento no encontrado.');
  const mov = movs[0];
  if (Number(mov.importe) <= 0) throw new Error('Ese movimiento no es un ingreso.');
  const { rows: ocupado } = await query(
    `SELECT 1 FROM larpmanager_pagos WHERE movimiento_id = $1 LIMIT 1`, [movimientoId]
  );
  if (ocupado.length > 0) throw new Error('Ese movimiento ya justifica un pago.');

  // Salen TODOS los pagos que se cruzan, no solo los que están esperando:
  //   - Los ignorados y los dados por buenos a mano, para poder darse cuenta
  //     de que el ingreso que tienes delante es de alguien a quien ignoraste.
  //   - Y los que YA tienen movimiento, con cuál, para poder cazar un enlace
  //     equivocado. Son la inmensa mayoría, así que la pantalla solo los
  //     enseña al buscar por nombre.
  // Ninguno de los dos grupos se puede elegir: uno ya tiene su movimiento y el
  // otro ya está contestado. Se ven, y punto.
  const { rows } = await query(
    `SELECT p.id, p.nombre_real, p.evento, p.importe, p.fecha, p.estado,
            m.id AS enlazado_id, m.fecha AS enlazado_fecha,
            m.importe AS enlazado_importe, m.concepto AS enlazado_concepto
     FROM larpmanager_pagos p
     LEFT JOIN movimientos m ON m.id = p.movimiento_id
     WHERE p.entra_en_cruce`
  );

  const palabras = new Set(normalizar(mov.concepto || '').split(' ').filter(Boolean));
  const fechaMov = mov.fecha ? new Date(mov.fecha).getTime() : null;
  return rows.map(p => {
    const variantes = normalizarVariantes(p.nombre_real);
    return {
      id: p.id, nombreReal: p.nombre_real, evento: p.evento,
      importe: Number(p.importe), fecha: p.fecha, estado: p.estado,
      enlazado: p.enlazado_id
        ? { id: p.enlazado_id, fecha: p.enlazado_fecha, importe: Number(p.enlazado_importe), concepto: p.enlazado_concepto }
        : null,
      mismoImporte: Math.abs(Number(p.importe) - Number(mov.importe)) <= TOLERANCIA,
      // Alguna palabra de su nombre está en el concepto. Se piden 4 letras
      // para no colar coincidencias absurdas (ver coincidenciaParcial).
      suNombre: variantes.some(v => v.split(' ').filter(t => t.length >= 4).some(t => palabras.has(t))),
      diasDeDiferencia: fechaMov && p.fecha
        ? Math.round(Math.abs(new Date(p.fecha).getTime() - fechaMov) / 86400000)
        : null,
    };
  }).sort((a, b) => {
    if (a.suNombre !== b.suNombre) return a.suNombre ? -1 : 1;
    if (a.mismoImporte !== b.mismoImporte) return a.mismoImporte ? -1 : 1;
    return (a.diasDeDiferencia ?? 9999) - (b.diasDeDiferencia ?? 9999);
  });
}

// Vincular a mano un pago con una línea del banco. Hace exactamente lo mismo
// que el camino automático, para no dejar la base de datos de dos formas
// distintas según por dónde se haya entrado:
//   - Si la línea ya estaba resuelta, solo se escribe el enlace. No se le
//     toca nada: ya tiene su nota y su estado, y el pago solo añade la
//     comprobación de que ese ingreso llegó.
//   - Si no lo estaba, además se le pone el proyecto que deduce el evento de
//     LarpManager (si no tenía ya uno) y se deja resuelta, igual que hace
//     resolverPagoLarpManager al aceptar la sugerencia.
async function vincularPagoAMano(pagoId, movimientoId) {
  await asegurarTablaPagosLarpManager();
  const { rows: pagos } = await query(
    `SELECT id, nombre_real, evento, importe, movimiento_id FROM larpmanager_pagos WHERE id = $1`,
    [pagoId]
  );
  if (pagos.length === 0) throw new Error('Pago no encontrado.');
  const pago = pagos[0];
  if (pago.movimiento_id) throw new Error('Ese pago ya está vinculado a un movimiento.');

  const { rows: movs } = await query(
    `SELECT id, estado, proyecto_id, importe FROM movimientos WHERE id = $1`,
    [movimientoId]
  );
  if (movs.length === 0) throw new Error('Movimiento no encontrado.');
  const mov = movs[0];
  if (Number(mov.importe) <= 0) throw new Error('Esa línea no es un ingreso.');

  if (mov.estado !== 'resuelta') {
    const proyectos = await listarProyectos();
    const proyecto = inferirProyecto(pago.evento || '', proyectos);
    if (proyecto && !mov.proyecto_id) {
      await query(`UPDATE movimientos SET proyecto_id = $1 WHERE id = $2`, [proyecto.id, movimientoId]);
    }
    await query(`UPDATE movimientos SET estado = 'resuelta', nota_final = NULL WHERE id = $1`, [movimientoId]);
  }

  await query(`UPDATE larpmanager_pagos SET movimiento_id = $1, estado = 'resuelta' WHERE id = $2`, [movimientoId, pagoId]);
  // La columna LarpManager de la tabla enseña este texto: sin esto, una línea
  // vinculada a mano seguiría diciendo "no encontrada".
  await query(
    `UPDATE movimientos SET datos_originales =
       COALESCE(datos_originales, '{}'::jsonb) || jsonb_build_object('larpmanager', $2::text)
     WHERE id = $1`,
    [movimientoId, `${pago.nombre_real} — ${pago.evento || ''}`.trim().replace(/ —$/, '')]
  );

  // Se aprende cómo llama el banco a esta persona, para que sus demás pagos
  // se cierren solos y no haya que vincularlos uno a uno.
  const { rows: linea } = await query(
    `SELECT concepto, datos_originales->>'ordenante' AS ordenante FROM movimientos WHERE id = $1`,
    [movimientoId]
  );
  const aprendidas = linea.length
    ? await aprenderComoLlamaElBanco(pago.nombre_real, linea[0].concepto, linea[0].ordenante)
    : 0;

  return { estadoCambiado: mov.estado !== 'resuelta', aprendidas };
}

// Deshacer un vínculo. Hace falta porque vincular a mano es una decisión de
// la usuaria y las decisiones se pueden equivocar: sin esto, el único remedio
// era borrar el CSV entero desde "Archivos subidos" y volver a subirlo.
//
// NO se toca el estado de la línea a propósito. Al vincular, si estaba
// pendiente se dejó resuelta -- pero no se guarda en ningún sitio si fue por
// esto o si ya lo estaba de antes, así que revertirlo sería adivinar. El
// desplegable de Estado siempre se puede cambiar a mano, y el diálogo lo dice.
async function desvincularPago(pagoId) {
  await asegurarTablaPagosLarpManager();
  const { rows } = await query(
    `SELECT id, nombre_real, movimiento_id FROM larpmanager_pagos WHERE id = $1`,
    [pagoId]
  );
  if (rows.length === 0) throw new Error('Pago no encontrado.');
  const pago = rows[0];
  if (!pago.movimiento_id) throw new Error('Ese pago no está vinculado a ninguna línea.');

  // Vuelve a pendiente: sin línea del banco, el pago está otra vez esperando
  // su ingreso, que es justo lo que se quiere ver en la lista.
  await query(`UPDATE larpmanager_pagos SET movimiento_id = NULL, estado = 'pendiente' WHERE id = $1`, [pagoId]);
  // Se quita el texto de la columna LarpManager: si se dejara, la línea
  // seguiría diciendo el nombre de alguien que ya no está vinculado.
  await query(
    `UPDATE movimientos SET datos_originales = datos_originales - 'larpmanager' WHERE id = $1`,
    [pago.movimiento_id]
  );
  return { movimientoId: pago.movimiento_id };
}

// Al confirmar (ver resolverConLarpManager en el frontend), marca también
// el pago de LarpManager correspondiente como ya emparejado -- por eso hace
// falta un endpoint propio en vez de reutilizar el genérico de confirmar
// nota a mano, que no sabe nada de esta tabla.
async function resolverPagoLarpManager(movimientoId, candidato) {
  await asegurarTablaPagosLarpManager();
  const { rows } = await query(`SELECT proyecto_id FROM movimientos WHERE id = $1`, [movimientoId]);
  if (rows.length === 0) throw new Error('Movimiento no encontrado.');
  const { proyecto_id: proyectoActual } = rows[0];

  if (candidato.proyectoSugerido && !proyectoActual) {
    await query(`UPDATE movimientos SET proyecto_id = $1 WHERE id = $2`, [candidato.proyectoSugerido.id, movimientoId]);
  }
  await query(`UPDATE movimientos SET estado = 'resuelta', nota_final = NULL WHERE id = $1`, [movimientoId]);
  await query(
    `UPDATE larpmanager_pagos SET movimiento_id = $1, estado = 'resuelta'
     WHERE estado = 'pendiente' AND nombre_real = $2 AND evento = $3 AND importe = $4 AND fecha = $5`,
    [movimientoId, candidato.nombreReal, candidato.evento, candidato.importe, candidato.fecha]
  );
}

function quitarAcentos(texto) {
  return (texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Los caracteres especiales (SEPA solo admite ASCII) no llegan al banco de
// una única forma: EL PROPIO BANCO ES INCONSISTENTE. Comprobado contra
// movimientos reales de producción el 2026-08-14:
//     "Kaltenhäuser"  ->  el banco escribió "Kaltenhaeuser"   (ä -> ae)
//     "Stöcklein"     ->  el banco escribió "Stocklein"       (ö -> o)
// La misma clase de carácter llega de las dos maneras, así que no existe
// una transliteración única correcta y elegir una deja fuera a la otra
// (antes solo se contemplaba la larga, y por eso fallaban los nórdicos).
// Se generan las DOS variantes de cada nombre y basta con que el banco haya
// escrito cualquiera de ellas. Esto va ANTES del quitado de acentos
// genérico: si no, ö/ø ya se habrían reducido a o y se perdería la variante.
const TRANSLITERACION_LARGA = { ä: 'ae', ö: 'oe', ü: 'ue', ø: 'oe', å: 'aa', æ: 'ae', ß: 'ss', ð: 'd', þ: 'th' };
const TRANSLITERACION_CORTA = { ä: 'a', ö: 'o', ü: 'u', ø: 'o', å: 'a', æ: 'ae', ß: 'ss', ð: 'd', þ: 'th' };

function transliterar(texto, mapa) {
  return (texto || '').replace(/[äöüøåæßðþ]/gi, c => {
    const reemplazo = mapa[c.toLowerCase()];
    if (!reemplazo) return c;
    return c === c.toLowerCase() ? reemplazo : reemplazo.charAt(0).toUpperCase() + reemplazo.slice(1);
  });
}

// El buscador/columnas ya normalizan a mayúsculas en el resto de la app —
// aquí además se quitan acentos y puntuación, porque el nombre que pone el
// banco casi nunca coincide con el de LarpManager al carácter exacto.
function normalizarCon(texto, mapa) {
  return quitarAcentos(transliterar(texto || '', mapa)).toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizar(texto) {
  return normalizarCon(texto, TRANSLITERACION_LARGA);
}

// Las formas posibles del mismo nombre. Para un nombre sin caracteres
// especiales las dos coinciden y devuelve una sola.
function normalizarVariantes(texto) {
  const larga = normalizarCon(texto, TRANSLITERACION_LARGA);
  const corta = normalizarCon(texto, TRANSLITERACION_CORTA);
  return larga === corta ? [larga] : [larga, corta];
}

// El campo "Member" del export es "Nombre Real - Nombre de personaje", o
// solo el nombre real si el jugador aún no tiene personaje asignado.
function nombreReal(member) {
  const idx = (member || '').indexOf(' - ');
  return idx === -1 ? (member || '').trim() : member.slice(0, idx).trim();
}

function parsearFechaLarpManager(texto) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((texto || '').trim());
  if (!m) return null;
  const [, dia, mes, anio] = m;
  const fecha = new Date(`${anio}-${mes}-${dia}`);
  return isNaN(fecha.getTime()) ? null : fecha;
}

// Qué filas del CSV se cruzan contra el banco.
//
// Se cruzan las transferencias (Wire) y las que NO traen método de pago. Lo
// que se deja fuera es una lista de exclusiones, no una lista cerrada de
// admitidos: si mañana LarpManager escribe otra cosa en Info con el método
// vacío, se cruzará sola sin tocar nada.
//
//   - `larpmoney` y `larpmanager` son apuntes internos: ese dinero no llega
//     nunca a la cuenta, así que no hay línea del banco que buscar.
//   - Stripe, Redsys y demás pasarelas se concilian por otro lado.
//
// Del CSV real de agosto: de 75 filas se cruzan 32 (30 Wire, una "manual" y
// una "marked as donation") y se quedan fuera 43.
const INFO_QUE_NO_LLEGA_AL_BANCO = ['larpmoney', 'larpmanager'];

function entraEnCruce(r) {
  const metodo = (r.Method || '').trim();
  const info = (r.Info || '').trim().toLowerCase();
  if (!r.Net) return false;
  if (metodo === 'Wire') return true;
  return !metodo && !INFO_QUE_NO_LLEGA_AL_BANCO.includes(info);
}

// Dos filas son la misma cuando TODAS sus columnas coinciden: el CSV no trae
// ningún identificador de pago. La posición en el archivo no sirve como
// desempate porque LarpManager pone los pagos nuevos arriba y desplaza el
// resto -- por eso la firma es del contenido, no del sitio.
function firmaDeFila(r) {
  return crypto.createHash('sha256').update(JSON.stringify(r)).digest('hex');
}

// Devuelve TODAS las filas del CSV, no solo las que se cruzan: las demás se
// guardan igual para poder revisar después qué se importó y por qué se
// descartó, sin volver a subir nada.
function parsearCSV(buffer) {
  const registros = parse(buffer, { columns: true, skip_empty_lines: true, bom: true, relax_column_count: true });
  return construirFilas(registros);
}

// LarpManager se puede exportar como CSV o como Excel, y los dos traen las
// mismas columnas. La cabecera NO está siempre en la misma fila (en un export
// está en la 1 y en otro en la 2, con columnas vacías delante), así que se
// busca la fila que trae "Member" y "Net" en vez de fijarla.
async function leerRegistrosExcel(buffer) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('El Excel no tiene ninguna hoja.');

  const texto = (row, c) => {
    const v = row.getCell(c).value;
    if (v === null || v === undefined) return '';
    if (v instanceof Date) {
      const d = String(v.getDate()).padStart(2, '0');
      const m = String(v.getMonth() + 1).padStart(2, '0');
      return `${d}/${m}/${v.getFullYear()}`;
    }
    if (typeof v === 'object') return String(v.result ?? v.text ?? (v.richText || []).map(x => x.text).join('') ?? '');
    return String(v);
  };

  const filas = [];
  ws.eachRow({ includeEmpty: false }, (row, n) => filas.push({ n, row }));

  let cabecera = null;
  for (const { row } of filas.slice(0, 20)) {
    const nombres = {};
    for (let c = 1; c <= ws.columnCount; c++) {
      const t = texto(row, c).trim();
      if (t) nombres[t] = c;
    }
    if (nombres.Member !== undefined && nombres.Net !== undefined) { cabecera = { fila: row, nombres }; break; }
  }
  if (!cabecera) throw new Error('No se ha encontrado la cabecera del export de LarpManager (falta "Member" o "Net").');

  const desde = filas.findIndex(f => f.row === cabecera.fila) + 1;
  const registros = [];
  for (const { row } of filas.slice(desde)) {
    const r = {};
    for (const [nombre, c] of Object.entries(cabecera.nombres)) r[nombre] = texto(row, c).trim();
    if (!r.Member) continue;
    registros.push(r);
  }
  return registros;
}

// Punto único de entrada: acepta el CSV y el Excel indistintamente.
async function parsearArchivoLarpManager(buffer, nombreArchivo = '') {
  if (/\.xlsx?$/i.test(nombreArchivo)) return construirFilas(await leerRegistrosExcel(buffer));
  return parsearCSV(buffer);
}

function construirFilas(registros) {
  const repeticiones = new Map();

  return registros.map(r => {
    const nombre = nombreReal(r.Member);
    const importe = Number(r.Net);
    const firma = firmaDeFila(r);
    const orden = repeticiones.get(firma) ?? 0;
    repeticiones.set(firma, orden + 1);
    return {
      nombreReal: nombre,
      nombresNormalizados: normalizarVariantes(nombre),
      evento: (r.Event || '').trim(),
      importe,
      fecha: parsearFechaLarpManager(r.Date),
      datosOriginales: r,
      entraEnCruce: entraEnCruce(r) && !!normalizarVariantes(nombre)[0] && !isNaN(importe) && importe > 0,
      firma,
      orden,
    };
  });
}

// El apellido (último token del nombre, 3+ letras) es la señal que se exige
// -- en un caso real, el nombre de pila del titular de la cuenta que envía
// la transferencia venía irreconocible ("Mw AS Tihaya" en vez de "Anna
// Tihaya", probablemente un problema de codificación del banco de origen)
// pero el apellido sí llegaba bien. Pedir TODOS los tokens (como antes)
// descartaba el candidato entero por eso; el apellido solo ya es bastante
// distintivo, y el importe filtra igualmente los falsos positivos después.
//
// El apellido tiene que ser una PALABRA ENTERA del concepto, no un trozo de
// texto dentro de otra palabra. Buscar el trozo daba falsos positivos donde
// más caro sale: en producción, el pago de 150 € de Nitzan Alon se cerró
// contra "TRANSFERENCIAS ANTON VIEJO ALONSO Registration fee 2 of Anton V"
// --"ALON" está dentro de "ALONSO"--, con el mismo importe y la fecha cerca.
// Resultado: la línea se la quitó a su dueño, el pago de Antón salía como
// pendiente teniendo su ingreso, y el de Nitzan salía como cobrado sin
// haberlo cobrado. Eso último es lo grave: dar por recibido dinero que no ha
// llegado.
//
// El cambio no rompe nada de lo que ya estaba bien: de los 220 pagos
// enlazados en producción, 194 encajaban por palabra entera, 22 por alias
// aprendido y 3 se vincularon a mano. Ni uno solo dependía de la búsqueda por
// trozo, salvo el falso de arriba. La puntuación no estorba porque
// `normalizar` la convierte en espacios.
function tokensCoinciden(nombresNormalizados, conceptoNormalizado) {
  const palabras = new Set(conceptoNormalizado.split(' ').filter(Boolean));
  return nombresNormalizados.some(n => {
    const tokens = n.split(' ').filter(t => t.length >= 3);
    if (tokens.length === 0) return false;
    return palabras.has(tokens[tokens.length - 1]);
  });
}

// Coincide alguna parte del nombre pero NO el apellido. No vale como
// emparejamiento (demasiado débil: "Anne" puede ser cualquier Anne), pero sí
// vale para explicar por qué un pago se quedó sin emparejar en vez de
// dejarlo caer en silencio.
// Se exigen 4 letras (no 3, como en el emparejamiento) porque aquí solo se
// busca dar una explicación útil: con 3 saltaban coincidencias absurdas --
// el "PER" de "Per Heegaard" aparece dentro de "SUPERMERCADOS".
function coincidenciaParcial(nombresNormalizados, conceptoNormalizado) {
  return nombresNormalizados.some(n => {
    const tokens = n.split(' ').filter(t => t.length >= 3);
    if (tokens.length <= 1) return false;
    if (conceptoNormalizado.includes(tokens[tokens.length - 1])) return false;
    return tokens.slice(0, -1).filter(t => t.length >= 4).some(t => conceptoNormalizado.includes(t));
  });
}

// Cruza los movimientos de ingreso sin resolver (todo el histórico) contra
// las filas Wire del CSV de LarpManager. El nombre es la señal principal (el
// importe casi nunca desambigua solo -- muchos jugadores pagan el mismo
// precio de entrada); el importe se usa para descartar candidatos cuando hay
// varios nombres parecidos.
async function emparejarIngresosConLarpManager(todasLasFilas, importacionId) {
  await asegurarColumnaLarpManager();
  // Se guardan todas las filas del CSV; solo se cruzan las que toca. El filtro
  // vive aquí, en el cruce, y ya no en la importación: así la regla se puede
  // cambiar y volver a cruzar sin tener que subir el archivo otra vez.
  await guardarPagosLarpManager(todasLasFilas, importacionId);
  // Fuera los que ya has contestado a mano (ignorado, o dado por bueno sin
  // línea). Vienen en el archivo igual que los demás --LarpManager no sabe
  // nada de esto-- así que sin este filtro volver a subir el export los
  // devolvería a la pantalla como si nunca los hubieras tocado.
  const { rows: contestados } = await query(
    `SELECT firma, orden FROM larpmanager_pagos WHERE estado <> 'pendiente' AND movimiento_id IS NULL`
  );
  const fuera = new Set(contestados.map(r => `${r.firma}|${r.orden}`));
  const filasCSV = todasLasFilas.filter(f => f.entraEnCruce && !fuera.has(`${f.firma}|${f.orden}`));
  // Se miran TAMBIÉN las líneas ya resueltas. Antes se filtraba por
  // `estado != 'resuelta'`, y eso hacía que cualquier transferencia punteada
  // a mano ANTES de subir el CSV fuera invisible para el cruce: su pago se
  // quedaba en "Pagos sin emparejar" para siempre, sin forma de recuperarlo
  // reintentando. El problema empeoraba cuanto más al día se llevara el
  // punteo. Encontrado el 2026-08-14: de 12 pagos listados como "sin
  // emparejar", los 12 habían llegado y estaban ya resueltos en el banco.
  // A una línea ya resuelta NO se le toca el estado ni se le pintan
  // sugerencias: lo único que le falta es el enlace, y se escribe solo.
  const { rows: movimientos } = await query(
    `SELECT id, concepto, importe, fecha, estado FROM movimientos WHERE importe > 0`
  );
  const proyectos = await listarProyectos();

  // El evento de LarpManager (ej. "Wield #2") es una señal mucho más fiable
  // de a qué proyecto pertenece el ingreso que el texto del concepto del
  // banco -- se reutiliza la misma función que ya usa el resto de la app
  // para sugerir proyecto (lib/proyectos.cjs), solo que aquí el "texto" de
  // entrada es el nombre del evento, no el concepto bancario.
  function sugerirProyecto(evento) {
    const p = inferirProyecto(evento, proyectos);
    return p ? { id: p.id, nombre: p.nombre } : null;
  }

  // UN PAGO SOLO PUEDE JUSTIFICAR UNA LÍNEA DEL BANCO, Y AL REVÉS. Antes esto
  // no se garantizaba: el cruce iba línea por línea y el mismo pago se podía
  // proponer en varias a la vez, así que dos cuotas de 150€ de la misma
  // persona encontraban las dos el mismo apunte.
  //
  // Se reparte de una vez, no línea a línea: se forman todas las parejas
  // posibles (mismo apellido y mismo importe exacto), se ordenan por cercanía
  // de fecha --antes o después, da igual el sentido: el desfase entre que se
  // registra el pago y el banco lo apunta va en las dos direcciones-- y se van
  // asignando de la más cercana a la más lejana, saltando las que ya tienen
  // pareja.
  const { rows: yaEnlazados } = await query(
    `SELECT firma, orden FROM larpmanager_pagos WHERE movimiento_id IS NOT NULL AND firma IS NOT NULL`
  );
  const clavePago = f => `${f.firma}|${f.orden}`;
  const tomados = new Set(yaEnlazados.map(r => `${r.firma}|${r.orden}`));

  // Mismo reparto que usa "Pagos sin emparejar" (ver repartirUnoAUno): una
  // sola implementación para los dos sitios.
  const alias = await cargarAlias();
  const { porLinea } = repartirUnoAUno(
    movimientos.map(m => ({ id: m.id, importe: m.importe, fecha: m.fecha, n: normalizar(m.concepto) })),
    filasCSV.filter(f => !tomados.has(clavePago(f)))
      .map(f => ({ clave: clavePago(f), importe: f.importe, fecha: f.fecha, variantes: f.nombresNormalizados, alias: alias.get(f.nombresNormalizados[0]) || [], fila: f })),
    await cargarRechazosPorFirma(),
  );
  const asignado = new Map();
  for (const [mid, p] of porLinea) asignado.set(mid, p.fila);

  const resultados = [];
  for (const m of movimientos) {
    const conceptoNormalizado = normalizar(m.concepto);
    const candidatos = filasCSV.filter(f => tokensCoinciden(f.nombresNormalizados, conceptoNormalizado));
    const suyo = asignado.get(m.id) || null;

    // Línea ya resuelta: no se le cambia nada de la fila, solo se cierra el
    // pago de LarpManager que le corresponde. No se pinta ninguna sugerencia
    // que confirmar, así que solo se escribe el enlace del pago que le ha
    // tocado en el reparto de arriba.
    if (m.estado === 'resuelta') {
      if (suyo) {
        const enlazado = await enlazarPagoConMovimiento(m.id, suyo);
        if (enlazado) resultados.push({ movimientoId: m.id, tipo: 'match_ya_resuelta', sugerenciaNota: null, candidatos: [] });
      }
      continue;
    }

    let tipo;
    let candidatosFinales = candidatos;
    let sugerenciaNota = null;

    if (candidatos.length === 0) {
      tipo = 'no_encontrado';
    } else {
      // Si el reparto le ha dado un pago, ese es -- y es uno solo. Si no se lo
      // ha dado, es que los que cuadraban de importe se los han quedado otras
      // líneas más cercanas en fecha, y aquí no queda nada que proponer:
      // ofrecer un pago ya asignado a otra línea es duplicarlo.
      const cuadranDeImporte = candidatos.filter(c => Math.abs(c.importe - Number(m.importe)) <= TOLERANCIA);
      const porImporte = suyo ? [suyo] : [];
      if (porImporte.length === 0 && cuadranDeImporte.length > 0) {
        tipo = 'no_encontrado';
        candidatosFinales = [];
      } else if (porImporte.length === 0) {
        // El nombre coincide pero NINGUNA cantidad cuadra: no se propone nada.
        // Antes sí se proponía --si solo había un nombre, se pintaba como un
        // match normal, con su píldora y sin decir el importe-- así que una
        // sugerencia con el importe equivocado se veía igual que una perfecta.
        // El caso real es alguien que paga en dos veces (90 de señal y 350
        // después): el nombre coincide con las dos líneas.
        // Un descuadre significa que la información de LarpManager está mal y
        // hay que corregirla allí, no resolver aquí la línea con el pago que
        // no es. El pago se queda en "Pagos sin emparejar", que ya lo explica
        // con los números: "el apellido sí aparece en el banco (350€), pero
        // ninguna línea es de 90€".
        tipo = 'importe_no_cuadra';
        candidatosFinales = [];
      } else {
        candidatosFinales = porImporte;
        if (candidatosFinales.length === 1) {
          tipo = 'match';
          sugerenciaNota = `LarpManager: ${candidatosFinales[0].nombreReal} — ${candidatosFinales[0].evento}`;
        } else {
          tipo = 'ambiguo';
        }
      }
    }

    const notaColumna = tipo === 'match'
      ? `${candidatosFinales[0].nombreReal} — ${candidatosFinales[0].evento}`
      : tipo === 'ambiguo'
        ? `${candidatosFinales.length} coincidencias posibles`
        // "no encontrada" sería mentira: el nombre sí se encontró, lo que
        // falla es la cantidad.
        : tipo === 'importe_no_cuadra'
          ? 'el importe no cuadra'
          : 'no encontrada';

    const candidatosGuardados = candidatosFinales.map(c => ({
      nombreReal: c.nombreReal, evento: c.evento, importe: c.importe,
      fecha: c.fecha ? c.fecha.toISOString().slice(0, 10) : null,
      proyectoSugerido: sugerirProyecto(c.evento),
    }));

    await query(
      `UPDATE movimientos SET
         datos_originales = COALESCE(datos_originales, '{}'::jsonb) || jsonb_build_object('larpmanager', $2::text),
         larpmanager_candidatos = $3::jsonb
       WHERE id = $1`,
      [m.id, notaColumna, JSON.stringify({ tipo, candidatos: candidatosGuardados })]
    );

    resultados.push({ movimientoId: m.id, tipo, sugerenciaNota, candidatos: candidatosGuardados });
  }

  return resultados;
}

module.exports = {
  parsearCSV, parsearArchivoLarpManager, emparejarIngresosConLarpManager, asegurarColumnaLarpManager,
  listarPagosLarpManagerSinEmparejar, resolverPagoLarpManager,
  listarCandidatosParaPago, vincularPagoAMano, desvincularPago,
  historialDeJugador, cambiarEstadoPago, rechazarSugerenciaLarpManager,
  listarPagosCandidatosParaMovimiento,
  // La ruta la llama antes de registrar la subida: la columna `origen` de
  // importaciones se crea aquí, y sin ella el registro falla.
  asegurarTablaPagosLarpManager,
  __norm: normalizar, __var: normalizarVariantes, __apellidoCoincide: tokensCoinciden,
  __aprender: aprenderComoLlamaElBanco,
};
