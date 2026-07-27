const { query } = require('./db.cjs');
const { cargarMemoria, registrarNota } = require('./memoria.cjs');
const { clasificarClave } = require('./normalize.cjs');
const { listarProyectos, inferirProyecto } = require('./proyectos.cjs');

// Construye el checklist de proveedores para un trimestre: agrupa los
// movimientos ya guardados en BD por hoja+clave, y clasifica cada grupo
// usando la memoria aprendida de trimestres anteriores.
async function construirProveedores(trimestreId) {
  const memoria = await cargarMemoria();
  const proyectos = await listarProyectos();
  const { rows: movimientosBrutos } = await query(
    `SELECT m.id, m.hoja, m.fila, m.fecha, m.concepto, m.importe, m.clave, m.estado, m.nota_final,
            m.proyecto_id, p.nombre AS proyecto_nombre,
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
  const movimientos = movimientosBrutos.map(m => {
    if (m.proyecto_id) return { ...m, proyecto_sugerido: null };
    const sugerido = inferirProyecto(m.concepto, proyectos);
    return { ...m, proyecto_sugerido: sugerido };
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

module.exports = { construirProveedores, confirmarGrupo, confirmarLinea, marcarGrupoPendiente };
