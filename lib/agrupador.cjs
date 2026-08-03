const { query } = require('./db.cjs');
const { cargarMemoria, registrarNota, cargarMemoriaProveedor, registrarProveedor } = require('./memoria.cjs');
const { clasificarClave, inferirProveedorPorTexto } = require('./normalize.cjs');
const { listarProyectos, inferirProyecto } = require('./proyectos.cjs');
const { asegurarColumnaLarpManager } = require('./larpmanager.cjs');
const { asegurarColumnasDevolucion, esProbableDevolucion, sugerirJugador } = require('./devoluciones.cjs');

// Construye el checklist de proveedores: agrupa los movimientos (histórico
// continuo, ya no hay trimestres) por hoja+clave, y clasifica cada grupo
// usando la memoria aprendida. `desde`/`hasta` (YYYY-MM-DD, opcionales)
// acotan por fecha -- sin ellos, trae todo el histórico.
async function construirProveedores(desde, hasta) {
  await asegurarColumnaLarpManager();
  await asegurarColumnasDevolucion();
  const memoria = await cargarMemoria();
  const memoriaProveedor = await cargarMemoriaProveedor();
  const proyectos = await listarProyectos();

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
              (SELECT array_agg(f.id ORDER BY f.id)
               FROM movimiento_facturas mf JOIN facturas f ON f.id = mf.factura_id
               WHERE mf.movimiento_id = m.id),
              '{}'
            ) AS factura_ids
     FROM movimientos m LEFT JOIN proyectos p ON p.id = m.proyecto_id
     ${where}`,
    params
  );

  // Si no tiene proyecto asignado, se sugiere uno por texto (sin guardarlo hasta que se confirme).
  // Si no tiene proveedor puesto a mano todavía, se sugiere primero el
  // nombre más usado para esa misma clave y, si no hay memoria de esa
  // clave, se cae a una palabra clave conocida en el texto del concepto
  // (ej. "Amazon") — así funciona aunque el mismo proveedor real dé conceptos
  // distintos entre sí y por tanto claves distintas.
  const movimientos = movimientosBrutos.map(m => {
    const proyecto_sugerido = m.proyecto_id ? null : inferirProyecto(m.concepto, proyectos);
    const proveedor_sugerido = m.proveedor
      ? null
      : (memoriaProveedor[m.hoja]?.[m.clave]?.nombre || inferirProveedorPorTexto(m.concepto) || null);
    // Se calcula aquí (servidor) y no en el navegador porque este mismo
    // módulo usa lib/db.cjs -- importarlo desde un componente cliente
    // metería el driver de Postgres en el bundle del navegador.
    const probable_devolucion = !m.es_devolucion && esProbableDevolucion(m.concepto);
    const jugador_sugerido = (!m.es_devolucion && !m.jugador_larpmanager) ? sugerirJugador(m.concepto) : null;
    return { ...m, proyecto_sugerido, proveedor_sugerido, probable_devolucion, jugador_sugerido };
  });

  const grupos = new Map();
  for (const m of movimientos) {
    const id = `${m.hoja}::${m.clave}`;
    if (!grupos.has(id)) {
      const clasificacion = clasificarClave((memoria[m.hoja] || {})[m.clave]);
      grupos.set(id, {
        id,
        hoja: m.hoja,
        clave: m.clave,
        categoria: clasificacion.categoria,
        subtipo: clasificacion.subtipo,
        sugerenciaNota: clasificacion.sugerenciaNota,
        detalle: clasificacion.detalle,
        movimientos: [],
      });
    }
    grupos.get(id).movimientos.push(m);
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

  // Pendientes primero; dentro de eso, nuevas/mixtas antes que fija.
  const ordenCategoria = { nueva: 0, mixta: 1, fija: 2 };
  resultado.sort((a, b) => {
    if (a.completo !== b.completo) return a.completo ? 1 : -1;
    return (ordenCategoria[a.categoria] ?? 9) - (ordenCategoria[b.categoria] ?? 9);
  });

  return resultado;
}

// Puntea de golpe todas las líneas de un grupo (categoría fija, o cuando el
// usuario decide aplicar la misma nota a todo el grupo).
async function confirmarGrupo(hoja, clave, nota) {
  const { rows } = await query(
    `UPDATE movimientos SET estado = 'resuelta', nota_final = $1
     WHERE hoja = $2 AND clave = $3
     RETURNING id`,
    [nota || null, hoja, clave]
  );
  if (nota) {
    for (let i = 0; i < rows.length; i++) {
      await registrarNota(hoja, clave, nota);
    }
  }
  return rows.length;
}

// Puntea una línea suelta (caso nuevo/mixto/conflicto resuelto a mano).
async function confirmarLinea(movimientoId, nota) {
  const { rows } = await query(
    `UPDATE movimientos SET estado = 'resuelta', nota_final = $1
     WHERE id = $2 RETURNING hoja, clave`,
    [nota || null, movimientoId]
  );
  if (rows.length && nota) {
    await registrarNota(rows[0].hoja, rows[0].clave, nota);
  }
  return rows.length > 0;
}

// Marca un grupo entero como "pedida, esperando al proveedor" — sin factura ni
// nota todavía, pero distinto de "sin empezar".
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

// Cambia el estado de una única línea — el desplegable de Estado en la
// tabla. A propósito no exige que la línea no estuviera ya resuelta: sirve
// también para deshacer una línea resuelta (o ignorada, o factura futura)
// por error, volviéndola a cualquier otro estado.
async function marcarLineaEstado(movimientoId, estado) {
  const nuevoEstado = MAPA_ESTADOS[estado] || 'sin_resolver';
  await query(`UPDATE movimientos SET estado = $1 WHERE id = $2`, [nuevoEstado, movimientoId]);
}

// Saca un movimiento de su grupo actual dándole una clave única — pasa a ser
// su propio grupo de una línea. Reutiliza el campo clave (ya sirve para
// agrupar y para la memoria aprendida) en vez de añadir una columna nueva;
// el sufijo se recorta en pantalla para que el nombre siga viéndose limpio.
async function separarDeGrupo(movimientoId) {
  await query(
    `UPDATE movimientos SET clave = clave || ' #' || id WHERE id = $1`,
    [movimientoId]
  );
}

// Asigna un proyecto a todas las líneas del grupo de golpe.
async function asignarProyectoGrupo(hoja, clave, proyectoId) {
  await query(
    `UPDATE movimientos SET proyecto_id = $1 WHERE hoja = $2 AND clave = $3`,
    [proyectoId || null, hoja, clave]
  );
}

// Proveedor es un nombre corto editable a mano por movimiento — a
// propósito no se deriva de la clave/concepto, la usuaria lo va rellenando
// ella misma. Cada vez que se confirma uno, se aprende por clave (igual que
// la Nota) para sugerirlo solo la próxima vez que aparezca esa clave.
async function actualizarProveedor(movimientoId, proveedor) {
  const limpio = (proveedor || '').trim() || null;
  const { rows } = await query(
    `UPDATE movimientos SET proveedor = $1 WHERE id = $2 RETURNING hoja, clave`,
    [limpio, movimientoId]
  );
  if (limpio && rows.length) {
    await registrarProveedor(rows[0].hoja, rows[0].clave, limpio);
  }
}

// Igual que actualizarProveedor pero para todas las líneas del grupo de golpe.
async function actualizarProveedorGrupo(hoja, clave, proveedor) {
  const limpio = (proveedor || '').trim() || null;
  await query(
    `UPDATE movimientos SET proveedor = $1 WHERE hoja = $2 AND clave = $3`,
    [limpio, hoja, clave]
  );
  if (limpio) {
    await registrarProveedor(hoja, clave, limpio);
  }
}

// Un proyecto no vive dentro de un trimestre -- al revisarlo/cerrarlo hace
// falta ver las facturas futuras (proveedores que no emiten factura hasta
// que ha pasado el servicio, ej. DoYouSpain/Iberia) todavía sin recuperar,
// de cualquier fecha. Mismo criterio que listarDevolucionesProyecto en
// lib/devoluciones.cjs.
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
  actualizarProveedor, actualizarProveedorGrupo, asignarProyectoGrupo, listarFacturasFuturasProyecto,
};
