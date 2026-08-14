const { parse } = require('csv-parse/sync');
const { query } = require('./db.cjs');
const { listarProyectos, inferirProyecto } = require('./proyectos.cjs');

const TOLERANCIA = 0.01;

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
  await query(`CREATE UNIQUE INDEX IF NOT EXISTS larpmanager_pagos_natural_key ON larpmanager_pagos(nombre_real, evento, importe, fecha)`);
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
async function guardarPagosLarpManager(filasCSV) {
  await asegurarTablaPagosLarpManager();
  if (filasCSV.length === 0) return;

  const placeholders = [];
  const valores = [];
  filasCSV.forEach((f, i) => {
    const base = i * 4;
    placeholders.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`);
    valores.push(f.nombreReal, f.evento, f.importe, f.fecha ? f.fecha.toISOString().slice(0, 10) : null);
  });

  await query(
    `INSERT INTO larpmanager_pagos (nombre_real, evento, importe, fecha)
     VALUES ${placeholders.join(', ')}
     ON CONFLICT (nombre_real, evento, importe, fecha) DO NOTHING`,
    valores
  );
}

// Todos los pagos de LarpManager que ningún movimiento del banco ha
// reclamado todavía -- el hueco que antes no se podía ver: si LarpManager
// dice que alguien pagó pero esa transferencia nunca aparece emparejada,
// aquí se queda listada para revisar a mano.
async function listarPagosLarpManagerSinEmparejar() {
  await asegurarTablaPagosLarpManager();
  const { rows } = await query(
    `SELECT id, nombre_real, evento, importe, fecha FROM larpmanager_pagos
     WHERE movimiento_id IS NULL
     ORDER BY fecha DESC NULLS LAST, nombre_real`
  );
  if (rows.length === 0) return rows;

  // Por qué no se emparejó cada uno. Antes esta lista no decía nada: un pago
  // aparecía ahí igual si la transferencia no había llegado, si el importe
  // no cuadraba o si el nombre coincidía a medias, y no había forma de
  // distinguirlo. Se calcula al vuelo contra los movimientos de hoy (no se
  // guarda) para que el motivo refleje siempre el estado actual del banco y
  // no el del día en que se subió el CSV.
  const { rows: movimientos } = await query(
    `SELECT concepto, importe FROM movimientos WHERE importe > 0`
  );
  const conceptos = movimientos.map(m => ({ importe: Number(m.importe), n: normalizar(m.concepto) }));
  const eur = n => `${Number(n).toFixed(2)}€`;

  return rows.map(p => {
    const variantes = normalizarVariantes(p.nombre_real);
    const porApellido = conceptos.filter(m => tokensCoinciden(variantes, m.n));

    if (porApellido.length > 0) {
      const cuadran = porApellido.filter(m => Math.abs(m.importe - Number(p.importe)) <= TOLERANCIA);
      if (cuadran.length === 0) {
        return {
          ...p, motivo: 'importe_no_cuadra',
          motivoTexto: `El apellido sí aparece en el banco (${porApellido.map(m => eur(m.importe)).join(', ')}), pero ninguna línea es de ${eur(p.importe)}.`,
        };
      }
      return {
        ...p, motivo: 'sin_confirmar',
        motivoTexto: cuadran.length === 1
          ? 'Encaja con una línea del banco por apellido e importe. Vuelve a subir el CSV y se cerrará solo.'
          : `Encaja con ${cuadran.length} líneas del banco por apellido e importe: hay que elegir cuál a mano.`,
      };
    }

    const parciales = conceptos.filter(m => coincidenciaParcial(variantes, m.n));
    if (parciales.length > 0) {
      return {
        ...p, motivo: 'nombre_parcial',
        motivoTexto: `Solo coincide parte del nombre, no el apellido, en ${parciales.length} línea(s). Puede ser otra persona: hay que mirarlo a mano.`,
      };
    }

    return {
      ...p, motivo: 'no_esta',
      motivoTexto: 'El nombre no aparece en ninguna línea del banco. O la transferencia no ha llegado, o falta por subir el excel de esas fechas.',
    };
  });
}

// Cierra un pago de LarpManager contra su línea del banco sin tocar la
// línea. Se usa cuando el movimiento ya estaba resuelto y por tanto no hay
// nada que confirmar en pantalla: lo único que faltaba era el enlace.
async function enlazarPagoConMovimiento(movimientoId, candidato) {
  const fecha = candidato.fecha ? candidato.fecha.toISOString().slice(0, 10) : null;
  const { rowCount } = await query(
    `UPDATE larpmanager_pagos SET movimiento_id = $1
     WHERE movimiento_id IS NULL AND nombre_real = $2 AND importe = $3
       AND (fecha = $4::date OR ($4::date IS NULL AND fecha IS NULL))`,
    [movimientoId, candidato.nombreReal, candidato.importe, fecha]
  );
  return rowCount > 0;
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
    `UPDATE larpmanager_pagos SET movimiento_id = $1
     WHERE nombre_real = $2 AND evento = $3 AND importe = $4 AND fecha = $5`,
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

// Solo interesan los pagos por transferencia (Wire) — el resto (Stripe,
// Redsys, Paypal, SumUp...) no se contrastan aquí, se gestionan aparte.
// Excepción: filas con "manual" en Info y sin Method — son pagos que la
// propia usuaria añadió a mano en LarpManager porque ya vio que habían
// llegado al banco (el jugador nunca subió justificante ahí), así que
// cuentan igual que un Wire confirmado para este cruce.
function parsearCSV(buffer) {
  const registros = parse(buffer, { columns: true, skip_empty_lines: true, bom: true, relax_column_count: true });
  return registros
    .filter(r => (r.Method === 'Wire' || /manual/i.test(r.Info || '')) && r.Net)
    .map(r => {
      const nombre = nombreReal(r.Member);
      const importe = Number(r.Net);
      return {
        nombreReal: nombre,
        nombresNormalizados: normalizarVariantes(nombre),
        evento: (r.Event || '').trim(),
        importe,
        fecha: parsearFechaLarpManager(r.Date),
      };
    })
    .filter(r => r.nombresNormalizados[0] && !isNaN(r.importe) && r.importe > 0);
}

// El apellido (último token del nombre, 3+ letras) es la señal que se exige
// -- en un caso real, el nombre de pila del titular de la cuenta que envía
// la transferencia venía irreconocible ("Mw AS Tihaya" en vez de "Anna
// Tihaya", probablemente un problema de codificación del banco de origen)
// pero el apellido sí llegaba bien. Pedir TODOS los tokens (como antes)
// descartaba el candidato entero por eso; el apellido solo ya es bastante
// distintivo, y el importe filtra igualmente los falsos positivos después.
function tokensCoinciden(nombresNormalizados, conceptoNormalizado) {
  return nombresNormalizados.some(n => {
    const tokens = n.split(' ').filter(t => t.length >= 3);
    if (tokens.length === 0) return false;
    return conceptoNormalizado.includes(tokens[tokens.length - 1]);
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
async function emparejarIngresosConLarpManager(filasCSV) {
  await asegurarColumnaLarpManager();
  await guardarPagosLarpManager(filasCSV);
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

  const resultados = [];
  for (const m of movimientos) {
    const conceptoNormalizado = normalizar(m.concepto);
    const candidatos = filasCSV.filter(f => tokensCoinciden(f.nombresNormalizados, conceptoNormalizado));

    // Línea ya resuelta: no se le cambia nada de la fila, solo se cierra el
    // pago de LarpManager que le corresponde. Se exige que sea inequívoco
    // (un único candidato Y que el importe cuadre), porque aquí no hay a
    // quien preguntar -- no se pinta ninguna sugerencia que confirmar.
    if (m.estado === 'resuelta') {
      const exactos = candidatos.filter(c => Math.abs(c.importe - Number(m.importe)) <= TOLERANCIA);
      if (exactos.length === 1) {
        const enlazado = await enlazarPagoConMovimiento(m.id, exactos[0]);
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
      const porImporte = candidatos.filter(c => Math.abs(c.importe - Number(m.importe)) <= TOLERANCIA);
      candidatosFinales = porImporte.length > 0 ? porImporte : candidatos;
      if (candidatosFinales.length === 1) {
        tipo = 'match';
        sugerenciaNota = `LarpManager: ${candidatosFinales[0].nombreReal} — ${candidatosFinales[0].evento}`;
      } else {
        tipo = 'ambiguo';
      }
    }

    const notaColumna = tipo === 'match'
      ? `${candidatosFinales[0].nombreReal} — ${candidatosFinales[0].evento}`
      : tipo === 'ambiguo'
        ? `${candidatosFinales.length} coincidencias posibles`
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
  parsearCSV, emparejarIngresosConLarpManager, asegurarColumnaLarpManager,
  listarPagosLarpManagerSinEmparejar, resolverPagoLarpManager,
};
