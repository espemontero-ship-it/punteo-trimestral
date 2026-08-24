const { query } = require('./db.cjs');
const {
  cargarMemoria, registrarNota, cargarMemoriaProveedor, registrarProveedor,
  olvidarProveedor, olvidarNota, cargarRechazos, estaRechazada, registrarRechazo,
} = require('./memoria.cjs');
const { clasificarClave, inferirProveedorPorTexto, proveedorSugeridoDesdeClave } = require('./normalize.cjs');
const { listarProyectos, inferirProyecto } = require('./proyectos.cjs');
const { asegurarColumnaLarpManager, asegurarTablaPagosLarpManager } = require('./larpmanager.cjs');
const { asegurarColumnasDevolucion, esProbableDevolucion, sugerirJugador } = require('./devoluciones.cjs');
const { asegurarColumnasMotivo, MARGEN_PARA_PROPONER, desviacion, avisoDeDesvio } = require('./facturaMatcher.cjs');
const { centimosDeMovimiento, aCentimos } = require('./importeFactura.cjs');
const { pagosSinConciliar } = require('./pagos.cjs');

function sugerirPago(movimiento, pagos, rechazada) {
  if (movimiento.estado === 'resuelta') return null;
  const centimosMov = centimosDeMovimiento(movimiento);
  const candidatos = pagos
    .filter(p => {
      const centimosPago = aCentimos(p.importe);
      const signoOpuesto = centimosPago > 0 ? centimosMov < 0 : centimosMov > 0;
      return signoOpuesto;
    })
    .map(p => ({ ...p, desvio: desviacion(movimiento, Math.abs(aCentimos(p.importe))) }))
    .filter(p => Math.abs(p.desvio) <= MARGEN_PARA_PROPONER)
    .sort((a, b) => Math.abs(a.desvio) - Math.abs(b.desvio));

  const c = candidatos[0];
  if (!c) return null;
  if (rechazada('pago', String(c.id))) return null;
  return {
    pagoId: c.id, colaboradorNombre: c.colaborador_nombre, proyectoNombre: c.proyecto_nombre,
    exacto: c.desvio === 0, diferencia: c.desvio / 100,
    texto: `pago de ${c.colaborador_nombre} · ${c.proyecto_nombre}${avisoDeDesvio(c.desvio)}`,
  };
}

async function construirProveedores(desde, hasta) {
  await asegurarColumnaLarpManager();

  await asegurarTablaPagosLarpManager();
  await asegurarColumnasDevolucion();

  await asegurarColumnasMotivo();
  const memoria = await cargarMemoria();
  const memoriaProveedor = await cargarMemoriaProveedor();
  const proyectos = await listarProyectos();

  const rechazos = await cargarRechazos();
  const pagosPendientes = await pagosSinConciliar();

  const condiciones = [];
  const params = [];
  if (desde) { params.push(desde); condiciones.push(`m.fecha >= $${params.length}`); }
  if (hasta) { params.push(hasta); condiciones.push(`m.fecha <= $${params.length}`); }
  const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';

  const { rows: movimientosBrutos } = await query(
    `SELECT m.id, m.hoja, m.fila, m.fecha, m.concepto, m.importe, m.clave, m.estado, m.nota_final,
            m.datos_originales, m.larpmanager_candidatos, m.proyecto_id, m.proveedor, p.nombre AS proyecto_nombre,
            m.es_devolucion, m.jugador_larpmanager,
            COALESCE(
              (SELECT jsonb_agg(jsonb_build_object('id', f.id, 'numero', f.numero) ORDER BY f.numero)
               FROM movimiento_facturas mf JOIN facturas f ON f.id = mf.factura_id
               WHERE mf.movimiento_id = m.id),
              '[]'::jsonb
            ) AS facturas,
            COALESCE(
              (SELECT jsonb_agg(jsonb_build_object('id', lp.id, 'nombre', lp.nombre_real, 'evento', lp.evento, 'importe', lp.importe) ORDER BY lp.id)
               FROM larpmanager_pagos lp WHERE lp.movimiento_id = m.id),
              '[]'::jsonb
            ) AS pagos_larpmanager,
            COALESCE(
              (SELECT jsonb_agg(jsonb_build_object(
                        'facturaId', f.id, 'numero', f.numero, 'concepto', f.concepto,
                        'proveedor', f.proveedor,
                        'importe', (SELECT COALESCE(SUM(t), 0) FROM unnest(f.totales) t),
                        'detalle', f.motivo_detalle,
                        'exacto', f.motivo_candidatos->'exacto',
                        'diferencia', f.motivo_candidatos->'diferencia',
                        'otras', COALESCE(f.motivo_candidatos->'otrasFacturas', '[]'::jsonb)) ORDER BY f.numero)
               FROM facturas f
               WHERE f.estado <> 'matcheada'
                 AND f.motivo_tipo = 'combo_sugerido'
                 AND (f.motivo_candidatos->>'movimientoId')::bigint = m.id),
              '[]'::jsonb
            ) AS combos_factura
     FROM movimientos m LEFT JOIN proyectos p ON p.id = m.proyecto_id
     ${where}`,
    params
  );

  const nombresUsados = [...new Set(movimientosBrutos.map(m => m.proveedor).filter(Boolean))]
    .sort((a, b) => b.length - a.length);
  function proveedorYaUsadoEnTexto(concepto) {
    const t = (concepto || '').toUpperCase();
    return nombresUsados.find(n => n.length >= 3 && t.includes(n.toUpperCase())) || null;
  }

  const idsOtrasFacturas = [...new Set(
    movimientosBrutos.flatMap(m => (m.combos_factura || []).flatMap(c => (c.otras || []).map(o => o.id)))
  )];
  const proveedorPorFactura = new Map();
  if (idsOtrasFacturas.length > 0) {
    const { rows: otrasFacturas } = await query(
      `SELECT id, proveedor FROM facturas WHERE id = ANY($1::bigint[])`,
      [idsOtrasFacturas]
    );
    for (const f of otrasFacturas) proveedorPorFactura.set(f.id, f.proveedor);
  }

  const movimientos = movimientosBrutos.map(m => {
    const rechazada = (tipo, valor) => estaRechazada(rechazos, m.hoja, m.clave, tipo, valor);

    const proyectoPropuesto = m.proyecto_id ? null : inferirProyecto(m.concepto, proyectos);

    const proyecto_sugerido = proyectoPropuesto && !rechazada('proyecto', proyectoPropuesto.nombre)
      ? proyectoPropuesto
      : null;

    const proveedorPropuesto = m.proveedor
      ? null
      : (memoriaProveedor[m.hoja]?.[m.clave]?.nombre
        || proveedorYaUsadoEnTexto(m.concepto)
        || inferirProveedorPorTexto(m.concepto)
        || proveedorSugeridoDesdeClave(m.clave)
        || null);

    const proveedor_sugerido = proveedorPropuesto && !rechazada('proveedor', '')
      ? proveedorPropuesto
      : null;

    const probable_devolucion = !m.es_devolucion
      && esProbableDevolucion(m.concepto)
      && !rechazada('devolucion', '');

    const jugadorPropuesto = (!m.es_devolucion && !m.jugador_larpmanager) ? sugerirJugador(m.concepto) : null;
    const jugador_sugerido = jugadorPropuesto && !rechazada('jugador', jugadorPropuesto)
      ? jugadorPropuesto
      : null;

    const combos_factura = (m.combos_factura || [])
      .filter(c => {
        const ids = [c.facturaId, ...(c.otras || []).map(o => o.id)].join(',');
        return !rechazada('combo', ids);
      })
      .map(c => ({
        ...c,
        otras: (c.otras || []).map(o => ({ ...o, proveedor: proveedorPorFactura.get(o.id) ?? null })),
      }));

    const pago_sugerido = sugerirPago(m, pagosPendientes, rechazada);

    return { ...m, proyecto_sugerido, proveedor_sugerido, probable_devolucion, jugador_sugerido, combos_factura, pago_sugerido };
  });

  const claveProveedor = p => `prov::${String(p).trim().toLowerCase()}`;

  const grupos = new Map();
  for (const m of movimientos) {
    const id = m.proveedor ? claveProveedor(m.proveedor) : `${m.hoja}::${m.clave}`;
    if (!grupos.has(id)) {
      grupos.set(id, {
        id,
        hoja: m.hoja,
        clave: m.clave,
        proveedor: m.proveedor || null,

        claves: [],
        movimientos: [],
      });
    }
    const g = grupos.get(id);
    if (!g.claves.some(k => k.hoja === m.hoja && k.clave === m.clave)) {
      g.claves.push({ hoja: m.hoja, clave: m.clave });
    }
    g.movimientos.push(m);
  }

  for (const g of grupos.values()) {
    const juntas = { total: 0, notas: {} };
    for (const k of g.claves) {
      const mem = (memoria[k.hoja] || {})[k.clave];
      if (!mem) continue;
      juntas.total += mem.total;
      for (const [nota, veces] of Object.entries(mem.notas)) {
        juntas.notas[nota] = (juntas.notas[nota] || 0) + veces;
      }
    }
    const clasificacion = clasificarClave(juntas.total > 0 ? juntas : undefined);
    g.categoria = clasificacion.categoria;
    g.subtipo = clasificacion.subtipo;
    g.sugerenciaNota = clasificacion.sugerenciaNota;
    g.detalle = clasificacion.detalle;
  }

  const resultado = [...grupos.values()].map(g => {
    const total = g.movimientos.length;
    const resueltas = g.movimientos.filter(m => m.estado === 'resuelta').length;
    const pedidaPendiente = g.movimientos.filter(m => m.estado === 'pedida_pendiente').length;
    const facturaFutura = g.movimientos.filter(m => m.estado === 'factura_futura').length;
    const ignoradas = g.movimientos.filter(m => m.estado === 'ignorada').length;
    const sinResolver = total - resueltas - pedidaPendiente - facturaFutura - ignoradas;
    return { ...g, total, resueltas, pedidaPendiente, facturaFutura, ignoradas, sinResolver, completo: sinResolver === 0 };
  });

  const tieneSugerencia = g => !!g.sugerenciaNota || g.movimientos.some(m =>
    m.proveedor_sugerido || m.proyecto_sugerido || m.probable_devolucion ||
    (m.larpmanager_candidatos && m.larpmanager_candidatos.tipo === 'match'));
  const ordenCategoria = { nueva: 0, mixta: 1, fija: 2 };
  resultado.sort((a, b) => {
    if (a.completo !== b.completo) return a.completo ? 1 : -1;
    const sa = tieneSugerencia(a) ? 0 : 1, sb = tieneSugerencia(b) ? 0 : 1;
    if (sa !== sb) return sa - sb;
    if (a.sinResolver !== b.sinResolver) return b.sinResolver - a.sinResolver;
    return (ordenCategoria[a.categoria] ?? 9) - (ordenCategoria[b.categoria] ?? 9);
  });

  return resultado;
}

async function confirmarGrupo(hoja, clave, nota) {
  const { rows } = await query(
    `UPDATE movimientos SET estado = 'resuelta', nota_final = $1
     WHERE hoja = $2 AND clave = $3
     RETURNING id`,
    [nota || null, hoja, clave]
  );

  for (let i = 0; i < rows.length; i++) {
    await registrarNota(hoja, clave, nota);
  }
  return rows.length;
}

async function confirmarLinea(movimientoId, nota) {
  const { rows } = await query(
    `UPDATE movimientos SET estado = 'resuelta', nota_final = $1
     WHERE id = $2 RETURNING hoja, clave`,
    [nota || null, movimientoId]
  );

  if (rows.length) {
    await registrarNota(rows[0].hoja, rows[0].clave, nota);
  }
  return rows.length > 0;
}

async function marcarGrupoPendiente(hoja, clave) {
  const { rowCount } = await query(
    `UPDATE movimientos SET estado = 'pedida_pendiente'
     WHERE hoja = $1 AND clave = $2 AND estado = 'sin_resolver'`,
    [hoja, clave]
  );
  return rowCount;
}

const MAPA_ESTADOS = {
  pedida: 'pedida_pendiente',
  factura_futura: 'factura_futura',
  ignorar: 'ignorada',
};

async function marcarLineaEstado(movimientoId, estado) {
  const nuevoEstado = MAPA_ESTADOS[estado] || 'sin_resolver';
  await query(`UPDATE movimientos SET estado = $1 WHERE id = $2`, [nuevoEstado, movimientoId]);
}

async function separarDeGrupo(movimientoId) {
  await query(
    `UPDATE movimientos SET clave = clave || ' #' || id WHERE id = $1`,
    [movimientoId]
  );
}

async function unirAGrupo(movimientoId, hoja, claveDestino) {
  await query(
    `UPDATE movimientos SET clave = $1 WHERE id = $2 AND hoja = $3`,
    [claveDestino, movimientoId, hoja]
  );
}

async function rechazarSugerencia({ hoja, clave, tipo, valor }) {
  if (tipo === 'nota') {
    await olvidarNota(hoja, clave, valor);
    return;
  }
  if (tipo === 'proveedor') {

    await olvidarProveedor(hoja, clave, valor);
    await registrarRechazo(hoja, clave, 'proveedor', '');
    return;
  }
  await registrarRechazo(hoja, clave, tipo, valor);
}

async function asignarProyectoGrupo(hoja, clave, proyectoId) {
  await query(
    `UPDATE movimientos SET proyecto_id = $1 WHERE hoja = $2 AND clave = $3`,
    [proyectoId || null, hoja, clave]
  );
}

async function actualizarProveedor(movimientoId, proveedor) {
  const limpio = (proveedor || '').trim() || null;

  const { rows: previas } = await query(
    `SELECT hoja, clave, proveedor FROM movimientos WHERE id = $1`,
    [movimientoId]
  );
  if (previas.length === 0) return;
  const { hoja, clave, proveedor: anterior } = previas[0];

  await query(`UPDATE movimientos SET proveedor = $1 WHERE id = $2`, [limpio, movimientoId]);

  if (limpio) {
    await registrarProveedor(hoja, clave, limpio);
  } else if (anterior) {

    await olvidarProveedor(hoja, clave, anterior);
  }
}

async function actualizarProveedorGrupo(hoja, clave, proveedor) {
  const limpio = (proveedor || '').trim() || null;

  const { rows: previas } = await query(
    `SELECT DISTINCT proveedor FROM movimientos WHERE hoja = $1 AND clave = $2 AND proveedor IS NOT NULL`,
    [hoja, clave]
  );

  await query(
    `UPDATE movimientos SET proveedor = $1 WHERE hoja = $2 AND clave = $3`,
    [limpio, hoja, clave]
  );

  if (limpio) {
    await registrarProveedor(hoja, clave, limpio);
  } else {

    for (const { proveedor: anterior } of previas) {
      await olvidarProveedor(hoja, clave, anterior);
    }
  }
}

async function listarFacturasFuturasProyecto(proyectoId) {
  const { rows } = await query(
    `SELECT id, fecha, importe, proveedor, concepto
     FROM movimientos
     WHERE proyecto_id = $1 AND estado = 'factura_futura'
     ORDER BY fecha`,
    [proyectoId]
  );
  return rows;
}

module.exports = {
  construirProveedores, confirmarGrupo, confirmarLinea, marcarGrupoPendiente, marcarLineaEstado, separarDeGrupo,
  unirAGrupo, actualizarProveedor, actualizarProveedorGrupo, asignarProyectoGrupo, listarFacturasFuturasProyecto,
  rechazarSugerencia,
};
