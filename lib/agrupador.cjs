const { query } = require('./db.cjs');
const {
  cargarMemoria, registrarNota, cargarMemoriaProveedor, registrarProveedor,
  olvidarProveedor, olvidarNota, cargarRechazos, estaRechazada, registrarRechazo,
} = require('./memoria.cjs');
const { clasificarClave, inferirProveedorPorTexto, proveedorSugeridoDesdeClave } = require('./normalize.cjs');
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
  // Lo que la usuaria ya ha rechazado con la ✕, para no volver a proponerlo.
  // Antes el rechazo solo vivía en el navegador y al recargar salían todas
  // otra vez -- que es justo lo que pasaba al volver de una subida.
  const rechazos = await cargarRechazos();

  const condiciones = [];
  const params = [];
  if (desde) { params.push(desde); condiciones.push(`m.fecha >= $${params.length}`); }
  if (hasta) { params.push(hasta); condiciones.push(`m.fecha <= $${params.length}`); }
  const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';

  const { rows: movimientosBrutos } = await query(
    `SELECT m.id, m.hoja, m.fila, m.fecha, m.concepto, m.importe, m.clave, m.estado, m.nota_final,
            m.datos_originales, m.larpmanager_candidatos, m.proyecto_id, m.proveedor, p.nombre AS proyecto_nombre,
            m.es_devolucion, m.jugador_larpmanager,
            -- Id Y número de cada factura, ordenadas por número: la columna
            -- Factura enseña el número (que es como se llama el archivo dentro
            -- del zip que va a la gestoría) y cada uno abre el suyo. Antes
            -- solo viajaba el id, así que la columna no podía poner más que
            -- "ver" y no había forma de saber cuál era sin abrirla.
            COALESCE(
              (SELECT jsonb_agg(jsonb_build_object('id', f.id, 'numero', f.numero) ORDER BY f.numero)
               FROM movimiento_facturas mf JOIN facturas f ON f.id = mf.factura_id
               WHERE mf.movimiento_id = m.id),
              '[]'::jsonb
            ) AS facturas
     FROM movimientos m LEFT JOIN proyectos p ON p.id = m.proyecto_id
     ${where}`,
    params
  );

  // Nombres de proveedor que la usuaria ya ha confirmado alguna vez, para
  // proponer los suyos antes que inventar uno nuevo. Se ordenan de más largo
  // a más corto para que gane el más específico si dos encajan.
  const nombresUsados = [...new Set(movimientosBrutos.map(m => m.proveedor).filter(Boolean))]
    .sort((a, b) => b.length - a.length);
  function proveedorYaUsadoEnTexto(concepto) {
    const t = (concepto || '').toUpperCase();
    return nombresUsados.find(n => n.length >= 3 && t.includes(n.toUpperCase())) || null;
  }

  // Si no tiene proyecto asignado, se sugiere uno por texto (sin guardarlo hasta que se confirme).
  // Si no tiene proveedor puesto a mano todavía, se sugiere primero el
  // nombre más usado para esa misma clave y, si no hay memoria de esa
  // clave, se cae a una palabra clave conocida en el texto del concepto
  // (ej. "Amazon") — así funciona aunque el mismo proveedor real dé conceptos
  // distintos entre sí y por tanto claves distintas.
  const movimientos = movimientosBrutos.map(m => {
    const rechazada = (tipo, valor) => estaRechazada(rechazos, m.hoja, m.clave, tipo, valor);

    const proyectoPropuesto = m.proyecto_id ? null : inferirProyecto(m.concepto, proyectos);
    // El rechazo guarda QUÉ se rechazó, no solo que se rechazó algo: decir que
    // no a "Glitz" para este tipo de movimiento no impide que mañana se
    // proponga "Wield 2".
    const proyecto_sugerido = proyectoPropuesto && !rechazada('proyecto', proyectoPropuesto.nombre)
      ? proyectoPropuesto
      : null;
    // Orden de preferencia: lo que ya confirmó la usuaria para esa clave >
    // un nombre de proveedor que ella ya use y aparezca en el concepto >
    // proveedor conocido en el texto > el nombre que queda al quitarle al
    // concepto la envoltura del banco ("COMPRA EN ___", "ADEUDO A SU CARGO
    // ___"...). Este último cubre la mitad de las claves reales, que antes
    // no proponían nada: la lista de proveedores conocidos tenía TRES
    // entradas (Amazon, Stripe, AliExpress), así que el campo Proveedor casi
    // nunca sugería y por eso no se rellenaba nunca.
    //
    // El segundo paso existe para que las propuestas converjan en los
    // nombres que ella ya usa en vez de crear casi-duplicados: tenía "alsa"
    // escrito a mano, y sin esto a otra clave de la misma empresa se le
    // habría propuesto "ALSA INTERNET", partiendo Alsa en dos proveedores.
    const proveedorPropuesto = m.proveedor
      ? null
      : (memoriaProveedor[m.hoja]?.[m.clave]?.nombre
        || proveedorYaUsadoEnTexto(m.concepto)
        || inferirProveedorPorTexto(m.concepto)
        || proveedorSugeridoDesdeClave(m.clave)
        || null);
    // La ✕ del proveedor calla las cuatro fuentes a la vez para ese tipo de
    // movimiento (ver rechazarSugerencia): quiere decir "aquí no hay
    // proveedor". Por eso se comprueba con valor vacío y no con el nombre.
    const proveedor_sugerido = proveedorPropuesto && !rechazada('proveedor', '')
      ? proveedorPropuesto
      : null;
    // Se calcula aquí (servidor) y no en el navegador porque este mismo
    // módulo usa lib/db.cjs -- importarlo desde un componente cliente
    // metería el driver de Postgres en el bundle del navegador.
    // La de devolución es un sí/no, no tiene valor que guardar.
    const probable_devolucion = !m.es_devolucion
      && esProbableDevolucion(m.concepto)
      && !rechazada('devolucion', '');

    const jugadorPropuesto = (!m.es_devolucion && !m.jugador_larpmanager) ? sugerirJugador(m.concepto) : null;
    const jugador_sugerido = jugadorPropuesto && !rechazada('jugador', jugadorPropuesto)
      ? jugadorPropuesto
      : null;

    return { ...m, proyecto_sugerido, proveedor_sugerido, probable_devolucion, jugador_sugerido };
  });

  // El mismo proveedor real llega del banco con conceptos distintos (ej.
  // "COMPRA EN ALSA INTERNET" y "REGULARIZACION COMPRA EN ALSA INTERNET"), y
  // como la clave se calcula del concepto, acababan en grupos separados. Si
  // la usuaria ha confirmado el proveedor, manda el proveedor: todas las
  // líneas del mismo proveedor van juntas aunque su clave sea distinta. Es
  // lo que hace que rellenar Proveedor sirva de algo -- antes era solo una
  // etiqueta encima de un grupo que ya estaba formado.
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
        // Todas las parejas hoja+clave que abarca el grupo. Para un grupo
        // normal es una sola; para uno unificado por proveedor, varias. Las
        // acciones de grupo (nota/proyecto/estado) las recorren todas.
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

  // La sugerencia de nota sale de lo aprendido. Un grupo unificado por
  // proveedor puede abarcar varias claves, así que se suman las respuestas
  // de todas antes de clasificar -- si no, se quedaría con la de una sola.
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

  // Orden: por dónde conviene empezar, no por qué tipo de gasto es.
  //   1. Pendientes antes que los ya cerrados.
  //   2. Los que ya traen algo propuesto antes que los que no: se resuelven
  //      de un clic, y despejan la pantalla de lo que sí hay que buscar.
  //   3. De más líneas sin resolver a menos: buscar una factura para un grupo
  //      de tres cierra tres líneas, no una.
  //   4. A igualdad de todo lo anterior, nuevas/mixtas antes que fija, que es
  //      el criterio que había hasta ahora.
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

// Puntea de golpe todas las líneas de un grupo (categoría fija, o cuando el
// usuario decide aplicar la misma nota a todo el grupo).
async function confirmarGrupo(hoja, clave, nota) {
  const { rows } = await query(
    `UPDATE movimientos SET estado = 'resuelta', nota_final = $1
     WHERE hoja = $2 AND clave = $3
     RETURNING id`,
    [nota || null, hoja, clave]
  );
  // Se aprende siempre, también el vacío: "aquí no va nota" es una respuesta
  // como cualquier otra (ver registrarNota en lib/memoria.cjs).
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
    [nota || null, movimientoId]
  );
  // Se aprende siempre, tambien el vacio (ver registrarNota).
  if (rows.length) {
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

// Inverso de separarDeGrupo: mete una línea suelta en un grupo ya existente
// dándole su misma clave -- mismo banco siempre (no tiene sentido unir entre
// hojas distintas), lo exige la propia consulta.
async function unirAGrupo(movimientoId, hoja, claveDestino) {
  await query(
    `UPDATE movimientos SET clave = $1 WHERE id = $2 AND hoja = $3`,
    [claveDestino, movimientoId, hoja]
  );
}

// La ✕ de una sugerencia, con memoria. El rechazo vale para TODO el tipo de
// movimiento (hoja+clave), no solo para la línea donde pulsaste: decir que no
// una vez sirve para todas sus líneas, las de ahora y las que lleguen.
//
// Nota y proveedor salen de lo que la usuaria confirmó antes, así que
// rechazarlas es OLVIDAR lo aprendido -- si no, la app seguiría creyendo que
// esa era la respuesta buena. El proveedor además se anota, porque no todas
// sus propuestas vienen de la memoria: algunas se leen del texto del banco y
// olvidar no las callaría.
async function rechazarSugerencia({ hoja, clave, tipo, valor }) {
  if (tipo === 'nota') {
    await olvidarNota(hoja, clave, valor);
    return;
  }
  if (tipo === 'proveedor') {
    // La ✕ del proveedor significa "aquí no hay proveedor", no "ese nombre no
    // me gusta": calla las CUATRO fuentes de las que puede salir la propuesta.
    // Si solo rechazara el nombre concreto, al descartar el aprendido saldría
    // el siguiente de la cascada y habría que insistir tres o cuatro veces en
    // las líneas que simplemente no llevan proveedor (banco, impuestos,
    // comisiones). Por eso se guarda con valor vacío, que vale por todas.
    await olvidarProveedor(hoja, clave, valor);
    await registrarRechazo(hoja, clave, 'proveedor', '');
    return;
  }
  await registrarRechazo(hoja, clave, tipo, valor);
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
  // Hace falta saber qué proveedor había ANTES para poder olvidarlo si se
  // está borrando -- por eso se lee primero en vez de usar RETURNING.
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
    // Quitar el proveedor desagrupa la línea; olvidar lo aprendido evita que
    // se lo vuelva a proponer acto seguido.
    await olvidarProveedor(hoja, clave, anterior);
  }
}

// Igual que actualizarProveedor pero para todas las líneas del grupo de golpe.
async function actualizarProveedorGrupo(hoja, clave, proveedor) {
  const limpio = (proveedor || '').trim() || null;
  // Mismos nombres que había antes, para poder olvidarlos si se está borrando
  // -- un grupo puede tener varios escritos distintos.
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
    // Igual que al quitarlo de una línea suelta: desagrupa y olvida, para que
    // no vuelva a proponerlo justo después.
    for (const { proveedor: anterior } of previas) {
      await olvidarProveedor(hoja, clave, anterior);
    }
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
  unirAGrupo, actualizarProveedor, actualizarProveedorGrupo, asignarProyectoGrupo, listarFacturasFuturasProyecto,
  rechazarSugerencia,
};
