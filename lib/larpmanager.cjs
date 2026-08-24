const crypto = require('crypto');
const { parse } = require('csv-parse/sync');
const { query } = require('./db.cjs');
const { listarProyectos, inferirProyecto } = require('./proyectos.cjs');

const TOLERANCIA = 0.01;

const NO_SON_DE_NADIE = `m.concepto NOT ILIKE '%LIQUIDACION REMESA DE COMERCIOS%'`;

function distanciaDias(a, b) {
  if (!a || !b) return 100000;
  return Math.abs(new Date(a) - new Date(b)) / 86400000;
}

function repartirUnoAUno(lineas, pagos, rechazados = new Set()) {
  const parejas = [];
  for (const l of lineas) {
    const palabrasLinea = new Set(String(l.n || '').split(' ').filter(Boolean));
    for (const p of pagos) {
      if (rechazados.has(`${p.clave}|${l.id}`)) continue;

      const porAlias = (p.alias || []).some(w => palabrasLinea.has(w));
      if (!porAlias && !tokensCoinciden(p.variantes, l.n)) continue;
      if (Math.abs(Number(p.importe) - Number(l.importe)) > TOLERANCIA) continue;
      parejas.push({ l, p, dist: distanciaDias(l.fecha, p.fecha) });
    }
  }
  parejas.sort((a, b) => a.dist - b.dist);
  const porLinea = new Map();
  const porPago = new Map();
  for (const { l, p } of parejas) {
    if (porLinea.has(l.id) || porPago.has(p.clave)) continue;
    porLinea.set(l.id, p);
    porPago.set(p.clave, l);
  }
  return { porLinea, porPago };
}

let columnaLarpManagerAsegurada = false;
async function asegurarColumnaLarpManager() {
  if (columnaLarpManagerAsegurada) return;
  await query(`ALTER TABLE movimientos ADD COLUMN IF NOT EXISTS larpmanager_candidatos JSONB`);
  columnaLarpManagerAsegurada = true;
}

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

const VECINAS = 2;

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

  for (const v of normalizarVariantes(nombreJugador)) for (const w of v.split(' ')) fuera.delete(w);
  return fuera;
}

async function aprenderComoLlamaElBanco(nombreJugador, concepto, ordenante) {
  await asegurarTablaAlias();

  const palabras = normalizar(`${concepto || ''} ${ordenante || ''}`).split(' ').filter(Boolean);
  const suyas = new Set(normalizarVariantes(nombreJugador).flatMap(v => v.split(' ')).filter(w => w.length >= 3));
  const anclas = palabras.map((w, i) => (suyas.has(w) ? i : -1)).filter(i => i >= 0);

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

  await query(`ALTER TABLE importaciones ADD COLUMN IF NOT EXISTS origen TEXT NOT NULL DEFAULT 'banco'`);
  await query(`ALTER TABLE larpmanager_pagos ADD COLUMN IF NOT EXISTS importacion_id BIGINT REFERENCES importaciones(id) ON DELETE SET NULL`);
  await query(`ALTER TABLE larpmanager_pagos ADD COLUMN IF NOT EXISTS datos_originales JSONB`);
  await query(`ALTER TABLE larpmanager_pagos ADD COLUMN IF NOT EXISTS entra_en_cruce BOOLEAN NOT NULL DEFAULT true`);
  await query(`ALTER TABLE larpmanager_pagos ADD COLUMN IF NOT EXISTS firma TEXT`);
  await query(`ALTER TABLE larpmanager_pagos ADD COLUMN IF NOT EXISTS orden INT NOT NULL DEFAULT 0`);

  await query(`ALTER TABLE larpmanager_pagos ADD COLUMN IF NOT EXISTS estado TEXT NOT NULL DEFAULT 'pendiente'`);

  await query(`UPDATE larpmanager_pagos SET estado = 'resuelta' WHERE movimiento_id IS NOT NULL AND estado = 'pendiente'`);
  await query(`CREATE INDEX IF NOT EXISTS idx_larpmanager_pagos_importacion ON larpmanager_pagos(importacion_id)`);
  await query(`DROP INDEX IF EXISTS larpmanager_pagos_natural_key`);
  await query(`CREATE UNIQUE INDEX IF NOT EXISTS larpmanager_pagos_firma_key ON larpmanager_pagos(firma, orden)`);
  await recalcularFirmas();
  tablaPagosAsegurada = true;
}

async function recalcularFirmas() {
  await query(`ALTER TABLE larpmanager_pagos ADD COLUMN IF NOT EXISTS firma_version INT NOT NULL DEFAULT 1`);
  const { rows } = await query(
    `SELECT id, datos_originales FROM larpmanager_pagos
     WHERE firma_version < 2 AND datos_originales IS NOT NULL ORDER BY id`
  );
  if (rows.length === 0) return 0;

  const vistas = new Map();
  for (const r of rows) {
    const firma = firmaDeFila(r.datos_originales);
    const orden = vistas.get(firma) ?? 0;
    vistas.set(firma, orden + 1);
    await query(
      `UPDATE larpmanager_pagos SET firma = $2, orden = $3, firma_version = 2 WHERE id = $1`,
      [r.id, firma, orden]
    );
  }
  return rows.length;
}

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

  await query(
    `INSERT INTO larpmanager_pagos
       (nombre_real, evento, importe, fecha, datos_originales, entra_en_cruce, firma, orden)
     VALUES ${placeholders.join(', ')}
     ON CONFLICT (firma, orden) DO NOTHING`,
    valores
  );

  if (importacionId) {

    const firmas = filasCSV.map(f => f.firma);
    await query(
      `UPDATE larpmanager_pagos SET importacion_id = $1
       WHERE importacion_id IS NULL AND firma = ANY($2::text[])`,
      [importacionId, firmas]
    );
  }
}

async function listarPagosLarpManagerSinEmparejar() {
  await asegurarTablaPagosLarpManager();

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

  const { rows: movimientos } = await query(
    `SELECT m.id, m.concepto, m.importe, m.fecha,
            lp.nombre_real AS ocupada_por, lp.fecha AS ocupada_fecha
     FROM movimientos m
     LEFT JOIN larpmanager_pagos lp ON lp.movimiento_id = m.id
     WHERE m.importe > 0 AND ${NO_SON_DE_NADIE}`
  );
  const conceptos = movimientos.map(m => ({
    id: m.id, importe: Number(m.importe), fecha: m.fecha, concepto: m.concepto, n: normalizar(m.concepto),
    ocupadaPor: m.ocupada_por ? { nombre: m.ocupada_por, fecha: m.ocupada_fecha } : null,
  }));

  const libres = conceptos.filter(c => !c.ocupadaPor);

  const alias = await cargarAlias();
  const rechazados = await cargarRechazosLarpManager();
  const { porPago } = repartirUnoAUno(libres, rows.filter(p => p.estado === 'pendiente').map(p => ({
    clave: p.id, importe: p.importe, fecha: p.fecha, variantes: normalizarVariantes(p.nombre_real),
    alias: alias.get(normalizarVariantes(p.nombre_real)[0]) || [],
  })), rechazados);

  const desfase = (fBanco, fPago) => {
    if (!fBanco || !fPago) return null;
    return Math.round((new Date(fBanco) - new Date(fPago)) / 86400000);
  };

  const porCercania = (fPago) => (a, b) =>
    Math.abs(desfase(a.fecha, fPago) ?? 9999) - Math.abs(desfase(b.fecha, fPago) ?? 9999);

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

    if (p.movimiento_id) {
      return {
        ...p, motivo: 'emparejado',
        motivoTexto: 'Emparejado',
      };
    }

    if (p.estado === 'ignorada') {
      return { ...p, motivo: 'ignorada', motivoTexto: 'Ignorado a mano' };
    }
    if (p.estado === 'resuelta') {
      return { ...p, motivo: 'resuelta_a_mano', motivoTexto: 'Dado por bueno a mano' };
    }

    const variantes = normalizarVariantes(p.nombre_real);
    const porApellido = conceptos.filter(m => tokensCoinciden(variantes, m.n));

    const suya = porPago.get(p.id);
    if (suya) {
      return {
        ...p, motivo: 'sin_confirmar',

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

async function listarCandidatosParaPago(pagoId) {
  await asegurarTablaPagosLarpManager();
  const { rows: pagos } = await query(
    `SELECT id, nombre_real, evento, importe, fecha FROM larpmanager_pagos WHERE id = $1`,
    [pagoId]
  );
  if (pagos.length === 0) throw new Error('Pago no encontrado.');
  const pago = pagos[0];

  const { rows } = await query(
    `SELECT m.id, m.fecha, m.concepto, m.importe, m.estado, m.hoja
     FROM movimientos m
     WHERE m.importe > 0 AND ${NO_SON_DE_NADIE}
       AND LOWER(COALESCE(m.proveedor, '')) <> 'stripe'
       AND NOT EXISTS (SELECT 1 FROM larpmanager_pagos p WHERE p.movimiento_id = m.id)
     ORDER BY m.fecha DESC NULLS LAST`
  );

  const dia = f => (f ? new Date(f).getTime() : null);
  const fechaPago = dia(pago.fecha);

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

    .sort((a, b) => {
      if (a.suNombre !== b.suNombre) return a.suNombre ? -1 : 1;
      if (a.mismoImporte !== b.mismoImporte) return a.mismoImporte ? -1 : 1;
      const da = a.diasDeDiferencia ?? 9999, db = b.diasDeDiferencia ?? 9999;
      return da - db;
    });
}

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

  await query(
    `UPDATE movimientos SET datos_originales =
       COALESCE(datos_originales, '{}'::jsonb) || jsonb_build_object('larpmanager', $2::text)
     WHERE id = $1`,
    [movimientoId, `${pago.nombre_real} — ${pago.evento || ''}`.trim().replace(/ —$/, '')]
  );

  const { rows: linea } = await query(
    `SELECT concepto, datos_originales->>'ordenante' AS ordenante FROM movimientos WHERE id = $1`,
    [movimientoId]
  );
  const aprendidas = linea.length
    ? await aprenderComoLlamaElBanco(pago.nombre_real, linea[0].concepto, linea[0].ordenante)
    : 0;

  return { estadoCambiado: mov.estado !== 'resuelta', aprendidas };
}

async function desvincularPago(pagoId) {
  await asegurarTablaPagosLarpManager();
  const { rows } = await query(
    `SELECT id, nombre_real, movimiento_id FROM larpmanager_pagos WHERE id = $1`,
    [pagoId]
  );
  if (rows.length === 0) throw new Error('Pago no encontrado.');
  const pago = rows[0];
  if (!pago.movimiento_id) throw new Error('Ese pago no está vinculado a ninguna línea.');

  await query(`UPDATE larpmanager_pagos SET movimiento_id = NULL, estado = 'pendiente' WHERE id = $1`, [pagoId]);

  await query(
    `UPDATE movimientos SET datos_originales = datos_originales - 'larpmanager' WHERE id = $1`,
    [pago.movimiento_id]
  );
  return { movimientoId: pago.movimiento_id };
}

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

const TRANSLITERACION_LARGA = { ä: 'ae', ö: 'oe', ü: 'ue', ø: 'oe', å: 'aa', æ: 'ae', ß: 'ss', ð: 'd', þ: 'th' };
const TRANSLITERACION_CORTA = { ä: 'a', ö: 'o', ü: 'u', ø: 'o', å: 'a', æ: 'ae', ß: 'ss', ð: 'd', þ: 'th' };

function transliterar(texto, mapa) {
  return (texto || '').replace(/[äöüøåæßðþ]/gi, c => {
    const reemplazo = mapa[c.toLowerCase()];
    if (!reemplazo) return c;
    return c === c.toLowerCase() ? reemplazo : reemplazo.charAt(0).toUpperCase() + reemplazo.slice(1);
  });
}

function normalizarCon(texto, mapa) {
  return quitarAcentos(transliterar(texto || '', mapa)).toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizar(texto) {
  return normalizarCon(texto, TRANSLITERACION_LARGA);
}

function normalizarVariantes(texto) {
  const larga = normalizarCon(texto, TRANSLITERACION_LARGA);
  const corta = normalizarCon(texto, TRANSLITERACION_CORTA);
  return larga === corta ? [larga] : [larga, corta];
}

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

const INFO_QUE_NO_LLEGA_AL_BANCO = ['larpmoney', 'larpmanager'];

function entraEnCruce(r) {
  const metodo = (r.Method || '').trim();
  const info = (r.Info || '').trim().toLowerCase();
  if (!r.Net) return false;
  if (metodo === 'Wire') return true;
  return !metodo && !INFO_QUE_NO_LLEGA_AL_BANCO.includes(info);
}

function firmaDeFila(r) {
  const fecha = parsearFechaLarpManager(r.Date);
  const importe = Number(r.Net);
  const clave = [
    fecha ? fecha.toISOString().slice(0, 10) : '',
    normalizar(nombreReal(r.Member)),
    isNaN(importe) ? '' : importe.toFixed(2),
  ].join('|');
  return crypto.createHash('sha256').update(clave).digest('hex');
}

function parsearCSV(buffer) {
  const registros = parse(buffer, { columns: true, skip_empty_lines: true, bom: true, relax_column_count: true });
  return construirFilas(registros);
}

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

function tokensCoinciden(nombresNormalizados, conceptoNormalizado) {
  const palabras = new Set(conceptoNormalizado.split(' ').filter(Boolean));
  return nombresNormalizados.some(n => {
    const tokens = n.split(' ').filter(t => t.length >= 3);
    if (tokens.length === 0) return false;
    return palabras.has(tokens[tokens.length - 1]);
  });
}

function coincidenciaParcial(nombresNormalizados, conceptoNormalizado) {
  return nombresNormalizados.some(n => {
    const tokens = n.split(' ').filter(t => t.length >= 3);
    if (tokens.length <= 1) return false;
    if (conceptoNormalizado.includes(tokens[tokens.length - 1])) return false;
    return tokens.slice(0, -1).filter(t => t.length >= 4).some(t => conceptoNormalizado.includes(t));
  });
}

async function emparejarIngresosConLarpManager(todasLasFilas, importacionId) {
  await asegurarColumnaLarpManager();

  await guardarPagosLarpManager(todasLasFilas, importacionId);

  const { rows: contestados } = await query(
    `SELECT firma, orden FROM larpmanager_pagos WHERE estado <> 'pendiente' AND movimiento_id IS NULL`
  );
  const fuera = new Set(contestados.map(r => `${r.firma}|${r.orden}`));
  const filasCSV = todasLasFilas.filter(f => f.entraEnCruce && !fuera.has(`${f.firma}|${f.orden}`));

  const { rows: movimientos } = await query(
    `SELECT id, concepto, importe, fecha, estado FROM movimientos m WHERE m.importe > 0 AND ${NO_SON_DE_NADIE}`
  );
  const proyectos = await listarProyectos();

  function sugerirProyecto(evento) {
    const p = inferirProyecto(evento, proyectos);
    return p ? { id: p.id, nombre: p.nombre } : null;
  }

  const { rows: yaEnlazados } = await query(
    `SELECT firma, orden FROM larpmanager_pagos WHERE movimiento_id IS NOT NULL AND firma IS NOT NULL`
  );
  const clavePago = f => `${f.firma}|${f.orden}`;
  const tomados = new Set(yaEnlazados.map(r => `${r.firma}|${r.orden}`));

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

      const cuadranDeImporte = candidatos.filter(c => Math.abs(c.importe - Number(m.importe)) <= TOLERANCIA);
      const porImporte = suyo ? [suyo] : [];
      if (porImporte.length === 0 && cuadranDeImporte.length > 0) {
        tipo = 'no_encontrado';
        candidatosFinales = [];
      } else if (porImporte.length === 0) {

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

  asegurarTablaPagosLarpManager,
  __norm: normalizar, __var: normalizarVariantes, __apellidoCoincide: tokensCoinciden,
  __aprender: aprenderComoLlamaElBanco,
};
