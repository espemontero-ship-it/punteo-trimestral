const { query } = require('./db.cjs');
const { cargarMemoria, registrarNota, cargarMemoriaProveedor, registrarProveedor } = require('./memoria.cjs');
const { clasificarClave } = require('./normalize.cjs');
const { listarProyectos, inferirProyecto } = require('./proyectos.cjs');

// Construye el checklist de proveedores para un trimestre: agrupa los
// movimientos ya guardados en BD por hoja+clave, y clasifica cada grupo
// usando la memoria aprendida de trimestres anteriores.
async function construirProveedores(trimestreId) {
  const memoria = await cargarMemoria();
  const memoriaProveedor = await cargarMemoriaProveedor();
  const proyectos = await listarProyectos();
  const { rows: movimientosBrutos } = await query(
    `SELECT m.id, m.hoja, m.fila, m.fecha, m.concepto, m.importe, m.clave, m.estado, m.nota_final,
            m.datos_originales, m.proyecto_id, m.proveedor, p.nombre AS proyecto_nombre,
            COALESCE(
              (SELECT array_agg(f.id ORDER BY f.id)
               FROM movimiento_facturas mf JOIN facturas f ON f.id = mf.factura_id
               WHERE mf.movimiento_id = m.id),
              '{}'
            ) AS factura_ids
     FROM movimientos m LEFT JOIN proyectos p ON p.id = m.proyecto_id
     WHERE m.trimestre_id = $1`,
    [trimestreId]
  );

  // Si no tiene proyecto asignado, se sugiere uno por texto (sin guardarlo hasta que se confirme).
  // Si no tiene proveedor puesto a mano todavía, se sugiere el nombre más
  // usado para esa misma clave (sin guardarlo hasta que se confirme).
  const movimientos = movimientosBrutos.map(m => {
    const proyecto_sugerido = m.proyecto_id ? null : inferirProyecto(m.concepto, proyectos);
    const proveedor_sugerido = m.proveedor ? null : (memoriaProveedor[m.hoja]?.[m.clave]?.nombre || null);
    return { ...m, proyecto_sugerido, proveedor_sugerido };
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
    const sinResolver = total - resueltas - pedidaPendiente;
    return { ...g, total, resueltas, pedidaPendiente, sinResolver, completo: sinResolver === 0 };
  });

  // Pendientes primero; dentro de eso, nuevas/mixtas antes que factura_propia/fija.
  const ordenCategoria = { nueva: 0, mixta: 1, factura_propia: 2, fija: 3 };
  resultado.sort((a, b) => {
    if (a.completo !== b.completo) return a.completo ? 1 : -1;
    return (ordenCategoria[a.categoria] ?? 9) - (ordenCategoria[b.categoria] ?? 9);
  });

  return resultado;
}

// Puntea de golpe todas las líneas de un grupo (categoría fija, o cuando el
// usuario decide aplicar la misma nota a todo el grupo).
async function confirmarGrupo(trimestreId, hoja, clave, nota) {
  const { rows } = await query(
    `UPDATE movimientos SET estado = 'resuelta', nota_final = $1
     WHERE trimestre_id = $2 AND hoja = $3 AND clave = $4
     RETURNING id`,
    [nota, trimestreId, hoja, clave]
  );
  for (let i = 0; i < rows.length; i++) {
    await registrarNota(hoja, clave, nota);
  }
  return rows.length;
}

// Puntea una línea suelta (caso nuevo/mixto/conflicto resuelto a mano).
async function confirmarLinea(movimientoId, nota) {
  const { rows } = await query(
    `UPDATE movimientos SET estado = 'resuelta', nota_final = $1
     WHERE id = $2 RETURNING hoja, clave`,
    [nota, movimientoId]
  );
  if (rows.length) {
    await registrarNota(rows[0].hoja, rows[0].clave, nota);
  }
  return rows.length > 0;
}

// Marca un grupo entero como "pedida, esperando al proveedor" — sin factura ni
// nota todavía, pero distinto de "sin empezar".
async function marcarGrupoPendiente(trimestreId, hoja, clave) {
  const { rowCount } = await query(
    `UPDATE movimientos SET estado = 'pedida_pendiente'
     WHERE trimestre_id = $1 AND hoja = $2 AND clave = $3 AND estado = 'sin_resolver'`,
    [trimestreId, hoja, clave]
  );
  return rowCount;
}

// Cambia el estado de una única línea a "pendiente" (sin_resolver) o "pedida"
// (pedida_pendiente) — el desplegable de Estado en la tabla. A propósito no
// exige que la línea no estuviera ya resuelta: sirve también para deshacer
// una línea resuelta por error, volviéndola a pendiente/pedida.
async function marcarLineaEstado(movimientoId, estado) {
  const nuevoEstado = estado === 'pedida' ? 'pedida_pendiente' : 'sin_resolver';
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
async function asignarProyectoGrupo(trimestreId, hoja, clave, proyectoId) {
  await query(
    `UPDATE movimientos SET proyecto_id = $1 WHERE trimestre_id = $2 AND hoja = $3 AND clave = $4`,
    [proyectoId || null, trimestreId, hoja, clave]
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
async function actualizarProveedorGrupo(trimestreId, hoja, clave, proveedor) {
  const limpio = (proveedor || '').trim() || null;
  await query(
    `UPDATE movimientos SET proveedor = $1 WHERE trimestre_id = $2 AND hoja = $3 AND clave = $4`,
    [limpio, trimestreId, hoja, clave]
  );
  if (limpio) {
    await registrarProveedor(hoja, clave, limpio);
  }
}

module.exports = { construirProveedores, confirmarGrupo, confirmarLinea, marcarGrupoPendiente, marcarLineaEstado, separarDeGrupo, actualizarProveedor, actualizarProveedorGrupo, asignarProyectoGrupo };
