const crypto = require('crypto');
const { query } = require('./db.cjs');
const { registrarNota } = require('./memoria.cjs');
const { descargarBlob, eliminarBlob } = require('./blob.cjs');

const { importeDeFactura, centimosDeFactura, centimosDeCadaFactura, centimosDeMovimiento } = require('./importeFactura.cjs');
const { leerFacturaConIA } = require('./facturaIA.cjs');
const { textoComboFacturas, avisoDeDesvio } = require('./textoCombo.cjs');

const MARGEN_PARA_PROPONER = 100;

function desviacion(movimiento, centimosFactura) {
  return Math.abs(centimosDeMovimiento(movimiento)) - Math.abs(centimosFactura);
}

const MAX_FACTURAS_EN_COMBO = 3;

let secuenciaLista = false;
async function asegurarSecuenciaDeNumeros() {
  if (secuenciaLista) return;
  await query(`CREATE SEQUENCE IF NOT EXISTS facturas_numero_seq`);
  await query(
    `SELECT setval('facturas_numero_seq',
            GREATEST((SELECT COALESCE(MAX(numero), 0) FROM facturas),
                     (SELECT last_value FROM facturas_numero_seq)))`
  );
  secuenciaLista = true;
}

async function siguienteNumero() {
  await asegurarSecuenciaDeNumeros();
  const { rows } = await query(`SELECT nextval('facturas_numero_seq') AS numero`);
  return Number(rows[0].numero);
}

async function movimientosPendientes(proveedorClave, centimosFactura) {

  const signo = centimosFactura < 0 ? 'importe > 0' : 'importe < 0';
  if (proveedorClave) {
    const [hoja, ...resto] = proveedorClave.split('::');
    const clave = resto.join('::');
    const { rows } = await query(
      `SELECT id, hoja, clave, importe, fecha, concepto FROM movimientos
       WHERE hoja = $1 AND clave = $2 AND ${signo}
         AND estado IN ('sin_resolver', 'pedida_pendiente')`,
      [hoja, clave]
    );
    return rows;
  }
  const { rows } = await query(
    `SELECT id, hoja, clave, importe, fecha, concepto FROM movimientos
     WHERE ${signo} AND estado IN ('sin_resolver', 'pedida_pendiente')`
  );
  return rows;
}

async function facturasSinResolver(proveedorClave, excluirId) {
  const { rows } = await query(
    proveedorClave
      ? `SELECT id, numero, totales, fechas, proveedor FROM facturas
         WHERE lote_id IS NULL AND proveedor_clave = $1 AND estado IN ('sin_match', 'revisar') AND id != $2`
      : `SELECT id, numero, totales, fechas, proveedor FROM facturas
         WHERE lote_id IS NULL AND proveedor_clave IS NULL AND estado IN ('sin_match', 'revisar') AND id != $1`,
    proveedorClave ? [proveedorClave, excluirId] : [excluirId]
  );
  return rows;
}

const MAX_FACTURAS_DEL_ARCHIVO = 4;

function sumasDeTotales(totales) {
  const trozos = centimosDeCadaFactura({ totales });
  const sumas = new Set();
  for (let tamano = 2; tamano <= MAX_FACTURAS_DEL_ARCHIVO; tamano++) {
    for (const grupo of combinaciones(trozos, tamano)) {
      sumas.add(grupo.reduce((a, b) => a + b, 0));
    }
  }
  return [...sumas];
}

async function emparejamientoDe(facturaId) {
  const { rows: mov } = await query(
    `SELECT m.id, m.fecha, m.importe, m.concepto FROM movimiento_facturas mf
     JOIN movimientos m ON m.id = mf.movimiento_id
     WHERE mf.factura_id = $1 LIMIT 1`, [facturaId]
  );
  if (mov.length === 0) return null;
  const { rows: facturas } = await query(
    `SELECT f.id, f.numero, f.totales FROM movimiento_facturas mf
     JOIN facturas f ON f.id = mf.factura_id
     WHERE mf.movimiento_id = $1 ORDER BY f.numero`, [mov[0].id]
  );
  const suma = facturas.reduce((acc, f) => acc + (importeDeFactura(f) || 0), 0);
  return { movimiento: mov[0], facturas, suma: Math.round(suma * 100) / 100 };
}

function diasEntre(a, b) {
  if (!a || !b) return null;
  return Math.abs((new Date(a).getTime() - new Date(b).getTime()) / 86400000);
}

async function intentarMatch(factura) {
  const { id: facturaId, numero, proveedor_clave: proveedorClave, fechas, concepto, proveedor } = factura;

  const monto = importeDeFactura(factura);

  const yaEmparejada = await emparejamientoDe(facturaId);
  if (yaEmparejada) {
    const { movimiento, facturas, suma } = yaEmparejada;
    const dela = Math.abs(Number(movimiento.importe));

    const diferencia = (Math.abs(centimosDeMovimiento(movimiento)) - Math.round(suma * 100)) / 100;
    const conQue = facturas.length > 1
      ? `las facturas ${facturas.map(f => f.numero).join(' + ')} suman ${suma.toFixed(2)}€`
      : `su importe es ${suma.toFixed(2)}€`;
    if (diferencia === 0) {
      return {
        tipo: 'emparejada_ok', numero, facturaId, movimientoId: movimiento.id,
        detalle: `Emparejada y cuadra: el movimiento del ${movimiento.fecha ? new Date(movimiento.fecha).toLocaleDateString('es-ES') : 'sin fecha'} es de ${dela.toFixed(2)}€ y ${conQue}.`,
      };
    }
    return {
      tipo: 'emparejada_no_cuadra', numero, facturaId, movimientoId: movimiento.id,
      detalle: `REVISAR: está emparejada con un movimiento de ${dela.toFixed(2)}€, pero ${conQue} — ${
        diferencia > 0 ? `faltan ${diferencia.toFixed(2)}€` : `sobran ${Math.abs(diferencia).toFixed(2)}€`
      }. No se ha cambiado nada: quita el vínculo desde Movimientos si está mal.`,
    };
  }

  if (monto === null) {
    return {
      tipo: 'sin_importe', numero, facturaId,
      detalle: 'No se ha reconocido el importe. Escríbelo a mano en la columna Importe.',
    };
  }

  if (factura.lote_id) {
    return {
      tipo: 'no_se_cruza', numero, facturaId,
      detalle: 'Factura de un colaborador: la paga él y se le reembolsa, así que no se busca línea del banco.',
    };
  }

  const centimos = centimosDeFactura(factura);
  const pendientes = await movimientosPendientes(proveedorClave, centimos);
  if (pendientes.length === 0) {
    return {
      tipo: 'sin_movimientos', numero, facturaId,
      detalle: 'Aún no hay movimientos de banco con los que comparar — se intentará automáticamente en cuanto subas o actualices el excel.',
    };
  }

  const fechaFactura = fechas && fechas[0];

  const candidatos = pendientes
    .map(m => ({ ...m, desvio: desviacion(m, centimos), dias: diasEntre(m.fecha, fechaFactura) }))
    .filter(c => Math.abs(c.desvio) <= MARGEN_PARA_PROPONER)
    .sort((a, b) => Math.abs(a.desvio) - Math.abs(b.desvio) || (a.dias ?? 9999) - (b.dias ?? 9999));

  if (candidatos.length > 0) {
    return {
      tipo: 'ambiguo', numero, facturaId, facturaConcepto: concepto,
      candidatos: candidatos.map(c => ({ movimientoId: c.id, concepto: c.concepto, importe: c.importe, fecha: c.fecha })),
      exacto: candidatos[0].desvio === 0,
      diferencia: candidatos[0].desvio / 100,
      detalle: candidatos.length === 1
        ? `Se corresponde con una línea de ${Math.abs(Number(candidatos[0].importe)).toFixed(2)}€ — confírmalo para emparejarlas.${avisoDeDesvio(candidatos[0].desvio)}`
        : `${candidatos.length} líneas pendientes se parecen a ${Math.abs(centimos / 100).toFixed(2)}€ — elige a cuál corresponde.${avisoDeDesvio(candidatos[0].desvio)}`,
    };
  }

  const sumasInternas = sumasDeTotales(factura.totales);
  if (sumasInternas.length > 0) {
    const porSuma = new Map();
    for (const suma of sumasInternas) {
      for (const m of pendientes) {
        const desvio = desviacion(m, suma);
        if (Math.abs(desvio) > MARGEN_PARA_PROPONER) continue;
        const guardada = porSuma.get(m.id);
        if (!guardada || Math.abs(desvio) < Math.abs(guardada.desvio)) {
          porSuma.set(m.id, { ...m, suma, desvio });
        }
      }
    }
    const porSumaLista = [...porSuma.values()];

    if (porSumaLista.length === 1) {
      const c = porSumaLista[0];
      return {
        tipo: 'combo_sugerido', numero, facturaId, facturaConcepto: concepto,
        movimientoId: c.id, suma: c.suma / 100, exacto: c.desvio === 0, diferencia: c.desvio / 100,
        otrasFacturas: [],
        detalle: `Este archivo trae varias facturas dentro y sus totales suman ${(c.suma / 100).toFixed(2)}€, contra la línea de ${Math.abs(Number(c.importe)).toFixed(2)}€. Confírmalo.${avisoDeDesvio(c.desvio)}`,
      };
    }
    if (porSumaLista.length > 1) {
      return {
        tipo: 'ambiguo', numero, facturaId, facturaConcepto: concepto,
        candidatos: porSumaLista.map(c => ({ movimientoId: c.id, concepto: c.concepto, importe: c.importe, fecha: c.fecha })),
        detalle: `Este archivo trae varias facturas dentro y la suma de sus totales cuadra con ${porSumaLista.length} líneas pendientes — elige a cuál corresponde.`,
      };
    }
  }

  const otras = await facturasSinResolver(null, facturaId)
    .then(rows => rows
      .map(o => ({ ...o, monto: importeDeFactura(o), centimos: centimosDeFactura(o) }))
      .filter(o => o.centimos !== null));

  const posibles = [];
  for (let tamano = 1; tamano <= MAX_FACTURAS_EN_COMBO - 1; tamano++) {
    for (const grupo of combinaciones(otras, tamano)) {
      const suma = centimos + grupo.reduce((acc, o) => acc + o.centimos, 0);
      for (const m of pendientes) {
        const desvio = desviacion(m, suma);
        if (Math.abs(desvio) > MARGEN_PARA_PROPONER) continue;
        posibles.push({ grupo, suma, match: m, desvio, cuantas: tamano + 1 });
      }
    }
  }

  posibles.sort((a, b) => Math.abs(a.desvio) - Math.abs(b.desvio) || a.cuantas - b.cuantas);

  const mejor = posibles[0];
  if (mejor) {
    const { grupo, suma, match, desvio } = mejor;
    return {
      tipo: 'combo_sugerido', numero, facturaId, facturaConcepto: concepto,
      movimientoId: match.id, suma: suma / 100, exacto: desvio === 0, diferencia: desvio / 100,
      otrasFacturas: grupo.map(o => ({ id: o.id, numero: o.numero, monto: o.monto })),
      detalle: textoComboFacturas({
        propia: { monto, proveedor },
        otras: grupo.map(o => ({ numero: o.numero, monto: o.monto, proveedor: o.proveedor })),
        linea: { importe: match.importe, concepto: match.concepto },
      }),
    };
  }

  const yaCubierta = await buscarLineaYaCubierta([monto, ...sumasInternas]);
  if (yaCubierta) {
    const fechaTexto = yaCubierta.fecha ? new Date(yaCubierta.fecha).toLocaleDateString('es-ES') : 'sin fecha';
    return {
      tipo: 'ya_cubierta', numero, facturaId, movimientoId: yaCubierta.id,
      detalle: `Ya cubierta: la línea de ${Math.abs(Number(yaCubierta.importe)).toFixed(2)}€ del ${fechaTexto} ya tiene la factura #${yaCubierta.factura_numero} (${yaCubierta.factura_nombre || 'sin nombre'}). Este archivo parece ser el mismo gasto — no falta nada, decide si te sobra.`,
    };
  }

  return { tipo: 'sin_match', numero, facturaId, detalle: `Importe (${monto.toFixed(2)}€) no coincide con ninguna línea pendiente, ni sola ni combinada. Revisa a mano.` };
}

async function buscarLineaYaCubierta(importesBuscados) {
  const valores = [...new Set(importesBuscados.filter(n => typeof n === 'number' && !isNaN(n) && n > 0))];
  if (valores.length === 0) return null;
  const { rows } = await query(
    `SELECT m.id, m.fecha, m.importe, m.concepto,
            f.numero AS factura_numero, f.nombre_original AS factura_nombre
     FROM movimientos m
     JOIN movimiento_facturas mf ON mf.movimiento_id = m.id
     JOIN facturas f ON f.id = mf.factura_id
     WHERE m.estado = 'resuelta' AND m.importe < 0
     ORDER BY m.fecha DESC NULLS LAST`
  );
  return rows.find(r => {
    const imp = Math.abs(Number(r.importe));
    return valores.some(v => Math.round(imp * 100) === Math.round(v * 100));
  }) || null;
}

function combinaciones(arr, tamano) {
  if (tamano === 0) return [[]];
  if (arr.length < tamano) return [];
  const [primero, ...resto] = arr;
  const conPrimero = combinaciones(resto, tamano - 1).map(c => [primero, ...c]);
  const sinPrimero = combinaciones(resto, tamano);
  return [...conPrimero, ...sinPrimero];
}

async function facturaConMismaHuella(huella, excluirId = 0) {
  if (!huella) return null;
  await asegurarColumnasMotivo();
  const { rows } = await query(
    `SELECT id, numero, nombre_original, creado_en FROM facturas
     WHERE huella = $1 AND id != $2 ORDER BY numero LIMIT 1`,
    [huella, excluirId]
  );
  return rows[0] || null;
}

async function procesarFacturaSubida({ hoja, clave, rutaBlob, nombreOriginal, concepto, analisis, subidoPor, proyectoId }) {
  const proveedorClave = hoja && clave ? `${hoja}::${clave}` : null;
  const numero = await siguienteNumero();
  await asegurarColumnasMotivo();

  const yaSubida = await facturaConMismaHuella(analisis.huella);
  if (yaSubida) {
    try { await eliminarBlob(rutaBlob); } catch {  }
    const cuando = yaSubida.creado_en ? new Date(yaSubida.creado_en).toLocaleDateString('es-ES') : null;
    return {
      tipo: 'duplicada',
      duplicada: { numero: yaSubida.numero, nombre: yaSubida.nombre_original, cuando },

      detalle: subidoPor
        ? `This file was already uploaded${cuando ? ` on ${cuando}` : ''}. It has not been saved again.`
        : `Este archivo ya está subido como factura #${yaSubida.numero} (${yaSubida.nombre_original})${
            cuando ? `, subida el ${cuando}` : ''}. No se ha vuelto a guardar.`,
    };
  }

  const insert = await query(

    `INSERT INTO facturas (proveedor_clave, ruta_blob, nombre_original, numero,
                            totales, fechas, concepto, estado, subido_por, proyecto_id,
                            proveedor, huella)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'sin_match',$8,$9,$10,$11)
     RETURNING *`,
    [
      proveedorClave, rutaBlob, nombreOriginal, numero,
      analisis.totales, analisis.fechas.map(f => f.toISOString().slice(0, 10)),
      concepto || null, subidoPor || null, proyectoId || null,
      analisis.proveedorIA || null,
      analisis.huella || null,
    ]
  );
  const factura = insert.rows[0];

  const resultado = await intentarMatch(factura);

  if (analisis.leidoConIA === false && analisis.motivoIA) {
    resultado.detalle = `La IA no está funcionando (${analisis.motivoIA}), así que esta factura se ha guardado sin importe: escríbelo a mano. ${resultado.detalle || ''}`.trim();
  }
  await aplicarEstado(factura.id, resultado);
  return resultado;
}

async function reintentarPendientes() {
  const { rows: pendientes } = await query(
    `SELECT * FROM facturas WHERE lote_id IS NULL AND estado IN ('sin_match', 'revisar')`
  );
  let resueltas = 0;
  for (const factura of pendientes) {
    const resultado = await intentarMatch(factura);
    await aplicarEstado(factura.id, resultado);
    if (resultado.tipo === 'match_directo') resueltas++;
  }
  return { revisadas: pendientes.length, resueltas };
}

function porQueNoLeyoLaIA(error) {
  const e = String(error || '');
  if (/credit balance/i.test(e)) return 'la cuenta de Anthropic no tiene saldo';
  if (/ANTHROPIC_API_KEY/i.test(e)) return 'falta configurar la clave de Anthropic';
  if (/rate limit|429/i.test(e)) return 'la API de Anthropic está saturada ahora mismo';
  if (/no ha podido leer un importe/i.test(e)) return 'no ha sabido leer ningún importe en el documento';
  return e.slice(0, 120);
}

async function analizarFactura(buffer, esPdf, nombreOriginal, leer = leerFacturaConIA) {
  const huella = crypto.createHash('sha256').update(buffer).digest('hex');
  const ia = await leer(buffer, esPdf, nombreOriginal);

  if (!ia.ok) {
    return { huella, totales: [], fechas: [], leidoConIA: false, motivoIA: porQueNoLeyoLaIA(ia.error) };
  }

  const fechas = ia.facturas.map(f => f.fecha).filter(Boolean).map(f => new Date(f))
    .filter(d => !isNaN(d.getTime()));

  const totales = ia.facturas.map(f => f.importe);
  return {
    huella,
    totales,
    fechas,
    leidoConIA: true,
    proveedorIA: ia.facturas.map(f => f.proveedor).filter(Boolean)[0] || null,
  };
}

async function confirmarImporteManual(facturaId, importe) {
  const { rows } = await query(
    `UPDATE facturas SET totales = ARRAY[$2::numeric]
     WHERE id = $1 RETURNING *`,
    [facturaId, importe]
  );
  if (rows.length === 0) throw new Error('Factura no encontrada.');

  const factura = rows[0];
  const resultado = await intentarMatch(factura);
  await aplicarEstado(factura.id, resultado);
  return resultado;
}

let columnasMotivoAseguradas = false;
async function asegurarColumnasMotivo() {
  if (columnasMotivoAseguradas) return;
  await query(`ALTER TABLE facturas ADD COLUMN IF NOT EXISTS motivo_tipo TEXT`);
  await query(`ALTER TABLE facturas ADD COLUMN IF NOT EXISTS motivo_detalle TEXT`);
  await query(`ALTER TABLE facturas ADD COLUMN IF NOT EXISTS motivo_candidatos JSONB`);

  await query(`ALTER TABLE facturas ADD COLUMN IF NOT EXISTS texto TEXT`);

  await query(`ALTER TABLE facturas ADD COLUMN IF NOT EXISTS lectura_regex JSONB`);
  await query(`ALTER TABLE facturas ADD COLUMN IF NOT EXISTS leido_con_ia BOOLEAN`);

  await query(`ALTER TABLE facturas ADD COLUMN IF NOT EXISTS proveedor TEXT`);

  await query(`ALTER TABLE facturas ADD COLUMN IF NOT EXISTS huella TEXT`);
  await query(`CREATE INDEX IF NOT EXISTS idx_facturas_huella ON facturas(huella)`);

  await query(`CREATE UNIQUE INDEX IF NOT EXISTS movimiento_facturas_una_por_factura ON movimiento_facturas(factura_id)`);

  await query(`ALTER TABLE facturas ADD COLUMN IF NOT EXISTS importe_a_mano BOOLEAN NOT NULL DEFAULT false`);
  columnasMotivoAseguradas = true;
}

async function confirmarDatosManual(facturaId, { importe, fecha, concepto, soloGuardar = false }) {
  const { rows } = await query(
    `UPDATE facturas SET
       totales = CASE WHEN $2::numeric IS NOT NULL THEN ARRAY[$2::numeric] ELSE totales END,
       fechas = CASE WHEN $3::date IS NOT NULL THEN ARRAY[$3::date] ELSE fechas END,
       concepto = COALESCE($4, concepto)
     WHERE id = $1 RETURNING *`,
    [facturaId, importe ?? null, fecha ?? null, concepto ?? null]
  );
  if (rows.length === 0) throw new Error('Factura no encontrada.');

  const factura = rows[0];
  if (soloGuardar) return { tipo: 'guardado' };
  const resultado = await intentarMatch(factura);
  await aplicarEstado(factura.id, resultado);
  return resultado;
}

function candidatosParaGuardar(resultado) {
  if (resultado.tipo === 'ambiguo') return { candidatos: resultado.candidatos };
  if (resultado.tipo === 'combo_sugerido') {
    return {
      movimientoId: resultado.movimientoId,
      otrasFacturas: resultado.otrasFacturas,
      detalle: resultado.detalle,

      exacto: resultado.exacto,
      diferencia: resultado.diferencia,
    };
  }
  return null;
}

async function aplicarEstado(facturaId, resultado) {
  await asegurarColumnasMotivo();

  if (resultado.tipo === 'emparejada_ok' || resultado.tipo === 'emparejada_no_cuadra') {
    await query(
      `UPDATE facturas SET motivo_tipo = $2, motivo_detalle = $3, motivo_candidatos = NULL WHERE id = $1`,
      [facturaId, resultado.tipo, resultado.detalle || null]
    );
    return;
  }
  const estado = resultado.tipo === 'match_directo' ? 'matcheada'
    : resultado.tipo === 'sin_movimientos' ? 'sin_match'
    : 'revisar';
  const candidatos = candidatosParaGuardar(resultado);
  await query(
    `UPDATE facturas SET estado = $2, motivo_tipo = $3, motivo_detalle = $4, motivo_candidatos = $5 WHERE id = $1 AND estado != 'matcheada'`,
    [facturaId, estado, resultado.tipo, resultado.detalle || null, candidatos ? JSON.stringify(candidatos) : null]
  );
}

async function resolverMovimiento(movimientoId, nota, facturaIds) {
  const { rows } = await query(
    `UPDATE movimientos SET estado = 'resuelta', nota_final = $1 WHERE id = $2 RETURNING hoja, clave`,
    [nota, movimientoId]
  );
  for (const facturaId of facturaIds) {
    await query(
      `INSERT INTO movimiento_facturas (movimiento_id, factura_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [movimientoId, facturaId]
    );
  }
  if (rows.length) await registrarNota(rows[0].hoja, rows[0].clave, nota);
}

async function confirmarMatch(movimientoId, facturaIds, notaFinal) {
  await resolverMovimiento(movimientoId, notaFinal, facturaIds);
  await query(
    `UPDATE facturas SET estado = 'matcheada' WHERE id = ANY($1::bigint[])`,
    [facturaIds]
  );
}

module.exports = {
  procesarFacturaSubida, confirmarMatch, confirmarImporteManual, confirmarDatosManual, reintentarPendientes,
  siguienteNumero, asegurarColumnasMotivo, analizarFactura,
  facturaConMismaHuella, importeDeFactura,
  MARGEN_PARA_PROPONER, desviacion, avisoDeDesvio,
};
