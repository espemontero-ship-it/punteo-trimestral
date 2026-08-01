const { parse } = require('csv-parse/sync');
const { query } = require('./db.cjs');

const TOLERANCIA = 0.01;

function quitarAcentos(texto) {
  return (texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// El buscador/columnas ya normalizan a mayúsculas en el resto de la app —
// aquí además se quitan acentos y puntuación, porque el nombre que pone el
// banco casi nunca coincide con el de LarpManager al carácter exacto.
function normalizar(texto) {
  return quitarAcentos(texto || '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
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
function parsearCSV(buffer) {
  const registros = parse(buffer, { columns: true, skip_empty_lines: true, bom: true, relax_column_count: true });
  return registros
    .filter(r => r.Method === 'Wire' && r.Net)
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

// Todos los tokens del nombre (de 3+ letras, para no exigir preposiciones o
// iniciales sueltas) tienen que aparecer en el concepto del banco -- más
// tolerante que buscar el nombre completo como substring exacto (orden de
// palabras distinto, texto de más pegado sin espacio, etc.) y más fiable que
// solo el nombre de pila, que se repite entre jugadores.
function tokensCoinciden(nombreNormalizado, conceptoNormalizado) {
  const tokens = nombreNormalizado.split(' ').filter(t => t.length >= 3);
  if (tokens.length === 0) return false;
  return tokens.every(t => conceptoNormalizado.includes(t));
}

// Cruza los movimientos de ingreso sin resolver del trimestre contra las
// filas Wire del CSV de LarpManager. El nombre es la señal principal (el
// importe casi nunca desambigua solo -- muchos jugadores pagan el mismo
// precio de entrada); el importe se usa para descartar candidatos cuando hay
// varios nombres parecidos.
async function emparejarIngresosConLarpManager(trimestreId, filasCSV) {
  const { rows: movimientos } = await query(
    `SELECT id, concepto, importe, fecha FROM movimientos
     WHERE trimestre_id = $1 AND estado != 'resuelta' AND importe > 0`,
    [trimestreId]
  );

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

    await query(
      `UPDATE movimientos SET datos_originales = COALESCE(datos_originales, '{}'::jsonb) || jsonb_build_object('larpmanager', $2::text)
       WHERE id = $1`,
      [m.id, notaColumna]
    );

    resultados.push({
      movimientoId: m.id,
      tipo,
      sugerenciaNota,
      candidatos: candidatosFinales.map(c => ({
        nombreReal: c.nombreReal, evento: c.evento, importe: c.importe,
        fecha: c.fecha ? c.fecha.toISOString().slice(0, 10) : null,
      })),
    });
  }

  return resultados;
}

module.exports = { parsearCSV, emparejarIngresosConLarpManager };
