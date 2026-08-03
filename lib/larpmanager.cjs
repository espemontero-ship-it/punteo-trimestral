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
  return rows;
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

// Las diéresis alemanas no son un acento normal: el banco (SEPA solo admite
// texto ASCII) las transcribe como dos letras -- "Kaltenhäuser" llega al
// banco como "Kaltenhaeuser" -- mientras que LarpManager conserva el
// carácter original tal cual lo escribió el jugador. Quitar el acento sin
// más dejaría "Kaltenhauser" (una sola A), que no coincide con ninguna de
// las dos formas reales. Hay que hacer esta sustitución ANTES del quitado de
// acentos genérico de abajo, si no, la ü/ö/ä ya se habría reducido a u/o/a.
function transliterarAlemanas(texto) {
  return (texto || '')
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
    .replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue')
    .replace(/ß/g, 'ss');
}

// El buscador/columnas ya normalizan a mayúsculas en el resto de la app —
// aquí además se quitan acentos y puntuación, porque el nombre que pone el
// banco casi nunca coincide con el de LarpManager al carácter exacto.
function normalizar(texto) {
  return quitarAcentos(transliterarAlemanas(texto || '')).toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
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
        nombreNormalizado: normalizar(nombre),
        evento: (r.Event || '').trim(),
        importe,
        fecha: parsearFechaLarpManager(r.Date),
      };
    })
    .filter(r => r.nombreNormalizado && !isNaN(r.importe) && r.importe > 0);
}

// El apellido (último token del nombre, 3+ letras) es la señal que se exige
// -- en un caso real, el nombre de pila del titular de la cuenta que envía
// la transferencia venía irreconocible ("Mw AS Tihaya" en vez de "Anna
// Tihaya", probablemente un problema de codificación del banco de origen)
// pero el apellido sí llegaba bien. Pedir TODOS los tokens (como antes)
// descartaba el candidato entero por eso; el apellido solo ya es bastante
// distintivo, y el importe filtra igualmente los falsos positivos después.
function tokensCoinciden(nombreNormalizado, conceptoNormalizado) {
  const tokens = nombreNormalizado.split(' ').filter(t => t.length >= 3);
  if (tokens.length === 0) return false;
  const apellido = tokens[tokens.length - 1];
  return conceptoNormalizado.includes(apellido);
}

// Cruza los movimientos de ingreso sin resolver (todo el histórico) contra
// las filas Wire del CSV de LarpManager. El nombre es la señal principal (el
// importe casi nunca desambigua solo -- muchos jugadores pagan el mismo
// precio de entrada); el importe se usa para descartar candidatos cuando hay
// varios nombres parecidos.
async function emparejarIngresosConLarpManager(filasCSV) {
  await asegurarColumnaLarpManager();
  await guardarPagosLarpManager(filasCSV);
  const { rows: movimientos } = await query(
    `SELECT id, concepto, importe, fecha FROM movimientos WHERE estado != 'resuelta' AND importe > 0`
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
    const candidatos = filasCSV.filter(f => tokensCoinciden(f.nombreNormalizado, conceptoNormalizado));

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
