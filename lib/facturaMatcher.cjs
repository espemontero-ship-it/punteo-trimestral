const { query } = require('./db.cjs');
const { registrarNota } = require('./memoria.cjs');
const { descargarBlob } = require('./blob.cjs');
// montoCaracteristico vive aquí y solo aquí -- antes había otra con el mismo
// nombre en este archivo, con distinta forma de llamarla.
const { analizarBuffer, montoCaracteristico } = require('./facturas.cjs');
const { leerFacturaConIA } = require('./facturaIA.cjs');

const TOLERANCIA = 0.01;
// Margen del combo: hasta 50 céntimos de diferencia entre la suma de las
// facturas y el importe de la línea. Es una APROXIMACIÓN, no un match, y por
// eso nunca se aplica sola -- se propone y la valida la usuaria, y el texto
// de la propuesta dice siempre cuánto se desvía.
//
// No hay ninguna explicación de por qué a veces no cuadra. El comentario que
// había aquí decía que era "una comisión de transferencia que el banco
// descuenta": eso era una suposición escrita como si fuera un hecho, a partir
// de un caso de 22 céntimos que no supe explicar (commit f70f88f, 13/8/2026),
// y sobre esa suposición se subió el margen de 2 céntimos a 50. Tres días
// después ese margen dio por bueno 124,74 € contra una línea de 125,00 €.
// El margen se mantiene porque lo ha decidido la usuaria; la explicación
// inventada, no.
const TOLERANCIA_COMBO = 0.5;
// Cuántas facturas sueltas se prueban combinadas como máximo -- más allá de
// esto el número de combinaciones crece muy rápido y el riesgo de un
// falso positivo (una suma que cuadra por casualidad) también.
const MAX_FACTURAS_EN_COMBO = 3;

// trimestreId solo se pasa desde el flujo de colaboradores/lotes (que sigue
// teniendo trimestre por ahora, ver lib/lotes.cjs) -- las facturas sueltas o
// de proveedor (flujo principal, continuo) usan una numeración propia,
// trimestre_id IS NULL, independiente de esa.
// UNA sola numeración para todas las facturas, las tuyas y las de
// colaboradores. Antes había dos secuencias independientes (la principal iba
// 1,2,3... y la de lotes por su cuenta), lo que hacía imposible referirse a
// una factura por su número sin decir además de cuál de las dos hablabas --
// y las de colaborador ni siquiera llegaban al paquete de la gestoría.
// Los huecos no importan: una factura que se sube y luego se rechaza se lleva
// su número y ese número no aparecerá en el zip. Se prefiere eso a renumerar
// al enviar, que cambiaría un número que el colaborador ya ha visto.
async function siguienteNumero() {
  const { rows } = await query('SELECT COALESCE(MAX(numero), 0) AS max FROM facturas');
  return rows[0].max + 1;
}

// Si proveedorClave es null, busca entre TODOS los movimientos pendientes
// (para facturas subidas antes de que exista el excel/el grupo). Los
// movimientos ya no pertenecen a ningún trimestre -- son un único histórico.
//
// SOLO GASTOS (`importe < 0`). Una factura justifica dinero que sale, nunca
// dinero que entra. Sin esta condición se ofrecían también los ingresos, y
// como la comparación se hace en valor absoluto, un ingreso de +125 € parecía
// un gasto de 125 €: en producción, dos facturas de compra que sumaban
// 124,74 € se propusieron —y se aceptaron— contra la transferencia de la
// inscripción de una jugadora.
async function movimientosPendientes(proveedorClave) {
  if (proveedorClave) {
    const [hoja, ...resto] = proveedorClave.split('::');
    const clave = resto.join('::');
    const { rows } = await query(
      `SELECT id, hoja, clave, importe, fecha, concepto FROM movimientos
       WHERE hoja = $1 AND clave = $2 AND importe < 0
         AND estado IN ('sin_resolver', 'pedida_pendiente')`,
      [hoja, clave]
    );
    return rows;
  }
  const { rows } = await query(
    `SELECT id, hoja, clave, importe, fecha, concepto FROM movimientos
     WHERE importe < 0 AND estado IN ('sin_resolver', 'pedida_pendiente')`
  );
  return rows;
}

// Limitado a trimestre_id IS NULL (facturas del flujo principal, no de lote)
// para no mezclar el matching automático con el flujo de colaboradores.
async function facturasSinResolver(proveedorClave, excluirId) {
  const { rows } = await query(
    proveedorClave
      ? `SELECT id, numero, totales, importes, fechas FROM facturas
         WHERE trimestre_id IS NULL AND proveedor_clave = $1 AND estado IN ('sin_match', 'revisar') AND id != $2`
      : `SELECT id, numero, totales, importes, fechas FROM facturas
         WHERE trimestre_id IS NULL AND proveedor_clave IS NULL AND estado IN ('sin_match', 'revisar') AND id != $1`,
    proveedorClave ? [proveedorClave, excluirId] : [excluirId]
  );
  return rows;
}


// Un mismo PDF puede traer VARIAS facturas dentro (Amazon manda una por
// vendedor cuando un pedido lleva productos de varios), y el banco cobra la
// suma en una única línea. Antes se cogía solo el total más alto y se tiraba
// el resto, así que ese archivo no encontraba su línea nunca: el caso real
// era 22,79 € + 20,99 € contra un cargo de 43,78 €.
// Se prueban las sumas de 2 y 3 totales distintos. No se suman TODOS a ciegas
// porque la lista incluye también base imponible e IVA de cada factura, no
// solo sus totales -- sumarlo todo daría un número que no existe.
function sumasDeTotales(totales) {
  const unicos = [...new Set((totales || []).map(Number).filter(n => !isNaN(n) && n > 0))];
  const sumas = new Set();
  for (let i = 0; i < unicos.length; i++) {
    for (let j = i + 1; j < unicos.length; j++) {
      sumas.add(Math.round((unicos[i] + unicos[j]) * 100) / 100);
      for (let k = j + 1; k < unicos.length; k++) {
        sumas.add(Math.round((unicos[i] + unicos[j] + unicos[k]) * 100) / 100);
      }
    }
  }
  return [...sumas];
}

function diasEntre(a, b) {
  if (!a || !b) return null;
  return Math.abs((new Date(a).getTime() - new Date(b).getTime()) / 86400000);
}

// Intenta emparejar una factura ya guardada (con o sin proveedor asignado)
// contra los movimientos pendientes de todo el histórico. Nunca resuelve nada
// ambiguo sola.
async function intentarMatch(factura) {
  const { id: facturaId, numero, proveedor_clave: proveedorClave, totales, importes, fechas, es_imagen: esImagen, textoMayus, concepto } = factura;

  const monto = montoCaracteristico(totales, importes);

  // El aviso de "es imagen" solo tiene sentido mientras no se sepa el importe
  // -- si ya se ha fijado a mano (o vinculado manualmente), monto no es null
  // y hay que seguir e intentar el match, no repetir algo que la usuaria ya
  // sabe y por lo que precisamente acaba de escribir el importe.
  if (monto === null) {
    const notaIA = (textoMayus || '').startsWith('IA: ') ? textoMayus.slice(4) : null;

    if (esImagen) {
      return {
        tipo: 'imagen_sin_texto', numero, facturaId,
        detalle: notaIA
          ? `Es una imagen — ${notaIA}`
          : 'Es una imagen — no se ha podido leer el importe automáticamente, revisa a mano.',
      };
    }
    if (notaIA) {
      return { tipo: 'sin_importe', numero, facturaId, detalle: `No se ha reconocido ningún importe. ${notaIA}` };
    }
    // Se incluye un trozo del texto extraído para poder ver por qué no
    // encontró el importe, sin tener que adivinar a ciegas otra vez.
    const muestra = (textoMayus || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    return {
      tipo: 'sin_importe', numero, facturaId,
      detalle: muestra
        ? `No se ha reconocido ningún importe. Texto leído: "${muestra}${textoMayus.length > 200 ? '...' : ''}"`
        : 'No se ha reconocido ningún importe en el archivo (no se pudo extraer texto). Revisa a mano.',
    };
  }

  const pendientes = await movimientosPendientes(proveedorClave);
  if (pendientes.length === 0) {
    return {
      tipo: 'sin_movimientos', numero, facturaId,
      detalle: 'Aún no hay movimientos de banco con los que comparar — se intentará automáticamente en cuanto subas o actualices el excel.',
    };
  }

  const usaTotal = (totales || []).includes(monto);
  const fechaFactura = fechas && fechas[0];

  // monto viene siempre positivo (extraerCandidatos descarta importes <= 0),
  // pero un gasto real en el banco se guarda en negativo -- comparar
  // directamente m.importe contra monto nunca daba match para ningún gasto
  // (la diferencia siempre salía enorme). Se compara en valor absoluto.
  const candidatos = pendientes
    .filter(m => Math.abs(Math.abs(Number(m.importe)) - monto) <= TOLERANCIA)
    .map(m => ({ ...m, dias: diasEntre(m.fecha, fechaFactura) }))
    .sort((a, b) => (a.dias ?? 9999) - (b.dias ?? 9999));

  if (candidatos.length === 1 || (candidatos.length > 1 && candidatos[0].dias !== null && candidatos[0].dias < (candidatos[1]?.dias ?? 9999))) {
    const movimiento = candidatos[0];
    // La nota es el concepto que escribiste al subir la factura, y nada más.
    // Antes, si no habías escrito ninguno, metía aquí el NÚMERO de la factura
    // -- que es información de otra columna, la de Factura, y acababa
    // mezclando tres cosas distintas en el mismo campo. Si no hay concepto, la
    // nota se queda vacía, que es una respuesta perfectamente válida: la
    // referencia a la factura ya viaja en su propia columna.
    const nota = concepto || '';
    await resolverMovimiento(movimiento.id, nota, [facturaId]);
    await query(
      `UPDATE facturas SET estado = 'matcheada', proveedor_clave = COALESCE(proveedor_clave, $2) WHERE id = $1`,
      [facturaId, `${movimiento.hoja}::${movimiento.clave}`]
    );
    return {
      tipo: 'match_directo', numero, facturaId, movimientoId: movimiento.id,
      detalle: usaTotal
        ? `Importe reconocido como total (${monto.toFixed(2)}€) — coincide con una única línea pendiente.`
        : `Importe (${monto.toFixed(2)}€) coincide, pero no aparece junto a la palabra "Total" en el PDF — verifícalo.`,
    };
  }

  if (candidatos.length > 1) {
    return {
      tipo: 'ambiguo', numero, facturaId, facturaConcepto: concepto,
      candidatos: candidatos.map(c => ({ movimientoId: c.id, concepto: c.concepto, importe: c.importe, fecha: c.fecha })),
      detalle: `${candidatos.length} líneas pendientes tienen el mismo importe (${monto.toFixed(2)}€) — elige a cuál corresponde.`,
    };
  }

  // El archivo trae varias facturas dentro y el banco las cobró juntas: se
  // prueban las sumas de sus totales.
  //
  // Esto NUNCA resuelve la línea solo, ni cuando cuadra con una única
  // pendiente: una suma es una conjetura, no un número impreso en la factura.
  // Con dos facturas dentro salen ya 29 sumas posibles, y alguna puede cuadrar
  // por casualidad con una línea que no es. Se propone y la confirma la
  // usuaria, igual que las combinaciones entre varios archivos.
  const sumasInternas = sumasDeTotales(totales);
  if (sumasInternas.length > 0) {
    const porSuma = new Map();
    for (const suma of sumasInternas) {
      for (const m of pendientes) {
        if (Math.abs(Math.abs(Number(m.importe)) - suma) <= TOLERANCIA && !porSuma.has(m.id)) {
          porSuma.set(m.id, { ...m, suma });
        }
      }
    }
    const porSumaLista = [...porSuma.values()];
    if (porSumaLista.length > 0) {
      const sumaTexto = porSumaLista.length === 1 ? ` (${porSumaLista[0].suma.toFixed(2)}€)` : '';
      return {
        tipo: 'ambiguo', numero, facturaId, facturaConcepto: concepto,
        candidatos: porSumaLista.map(c => ({ movimientoId: c.id, concepto: c.concepto, importe: c.importe, fecha: c.fecha })),
        detalle: porSumaLista.length === 1
          ? `Este archivo trae varias facturas dentro y sus totales suman${sumaTexto}, que es el importe de esta línea. Confirma si es correcto.`
          : `Este archivo trae varias facturas dentro y la suma de sus totales cuadra con ${porSumaLista.length} líneas pendientes — elige a cuál corresponde.`,
      };
    }
  }

  // Sin match directo: probar combinación con otras facturas sin resolver.
  //
  // TODAS, no solo las del mismo proveedor. Antes se restringía por proveedor
  // cuando la factura lo tenía puesto, y no cuando no -- así que el mismo
  // archivo se comparaba con un conjunto u otro según un dato que no tiene
  // nada que ver con si dos gastos se cobraron juntos. El banco agrupa por
  // cargo, no por proveedor.
  const otras = await facturasSinResolver(null, facturaId)
    .then(rows => rows
      .map(o => ({ ...o, monto: montoCaracteristico(o.totales, o.importes) }))
      .filter(o => o.monto !== null));

  // Se recogen TODAS las combinaciones que caen dentro del margen y se elige
  // la mejor: primero la que cuadre exacta, y entre las que no cuadran, la que
  // menos se desvíe; a igualdad, la de menos facturas. Antes se cogía la
  // primera que salía de la base de datos y se paraba ahí, así que podía
  // proponerte una desviada 40 céntimos habiendo otra exacta.
  const posibles = [];
  for (let tamano = 1; tamano <= MAX_FACTURAS_EN_COMBO - 1; tamano++) {
    for (const grupo of combinaciones(otras, tamano)) {
      const suma = Math.round((monto + grupo.reduce((acc, o) => acc + o.monto, 0)) * 100) / 100;
      for (const m of pendientes) {
        const dela = Math.abs(Number(m.importe));
        const diferencia = Math.round((dela - suma) * 100) / 100;
        if (Math.abs(diferencia) > TOLERANCIA_COMBO) continue;
        posibles.push({ grupo, suma, match: m, dela, diferencia, cuantas: tamano + 1 });
      }
    }
  }
  posibles.sort((a, b) => Math.abs(a.diferencia) - Math.abs(b.diferencia) || a.cuantas - b.cuantas);

  const mejor = posibles[0];
  if (mejor) {
    const { grupo, suma, match, dela, diferencia } = mejor;
    const otrasTexto = grupo.map(o => `la factura ${o.numero} (${o.monto.toFixed(2)}€)`).join(' + ');
    // Cuánto se desvía, dicho siempre. Antes ponía "cerca del importe de una
    // línea pendiente", que no dice si falta un céntimo o cuarenta.
    // Cuadrar al céntimo es lo normal y no se avisa de nada. El aviso es para
    // el error: cuando no cuadra, se dice cuánto se desvía y se pide mirarlo.
    const exacto = Math.abs(diferencia) <= TOLERANCIA;
    const aviso = exacto
      ? `y cuadran con la línea de ${dela.toFixed(2)}€.`
      : `pero la línea es de ${dela.toFixed(2)}€: NO CUADRA, ${
          diferencia > 0 ? `faltan ${diferencia.toFixed(2)}€` : `sobran ${Math.abs(diferencia).toFixed(2)}€`
        }. Compruébalo antes de aceptar.`;
    return {
      tipo: 'combo_sugerido', numero, facturaId, facturaConcepto: concepto,
      movimientoId: match.id, suma, exacto, diferencia,
      // El importe viaja con cada factura: sin él, en pantalla solo se ven
      // los números ("combinar facturas 13 + 14") y no hay forma de juzgar
      // si la combinación tiene sentido. El servidor ya lo conocía -- lo
      // usa aquí abajo para el texto de `detalle` -- pero no lo mandaba.
      otrasFacturas: grupo.map(o => ({ id: o.id, numero: o.numero, monto: o.monto })),
      detalle: `Esta factura (${monto.toFixed(2)}€) + ${otrasTexto} suman ${suma.toFixed(2)}€, ${aviso}`,
    };
  }

  // Antes de darlo por perdido: puede que el gasto ya esté cubierto por otra
  // factura que se subió antes. Pasa cuando el proveedor manda el mismo cargo
  // dos veces -- una con el total de una pieza y otra desglosada por vendedor.
  // Sin esto, el motivo era "no coincide con ninguna línea pendiente", que es
  // cierto pero no dice lo único que hace falta saber: que no falta nada.
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

// Líneas ya resueltas Y con factura, cuyo importe coincida con alguno de los
// que trae este archivo. Solo sirve para explicar, no cambia nada.
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
    return valores.some(v => Math.abs(imp - v) <= TOLERANCIA);
  }) || null;
}

// Todas las combinaciones de `tamano` elementos de `arr`, sin repetir ni
// importar el orden -- para probar tríos/cuartetos de facturas sin generar
// más código del necesario para algo tan acotado (MAX_FACTURAS_EN_COMBO).
function combinaciones(arr, tamano) {
  if (tamano === 0) return [[]];
  if (arr.length < tamano) return [];
  const [primero, ...resto] = arr;
  const conPrimero = combinaciones(resto, tamano - 1).map(c => [primero, ...c]);
  const sinPrimero = combinaciones(resto, tamano);
  return [...conPrimero, ...sinPrimero];
}

// Guarda una factura recién subida (flujo principal, no lote). `hoja`/`clave`
// son opcionales: si aún no existe el excel del banco (o no se sabe el
// proveedor), se sube sin asignar y se reintentará el match automáticamente
// cuando haya movimientos. No pertenece a ningún trimestre.
async function procesarFacturaSubida({ hoja, clave, rutaBlob, nombreOriginal, concepto, analisis, subidoPor, proyectoId }) {
  const proveedorClave = hoja && clave ? `${hoja}::${clave}` : null;
  const numero = await siguienteNumero();
  await asegurarColumnasMotivo();

  const insert = await query(
    `INSERT INTO facturas (proveedor_clave, ruta_blob, nombre_original, numero,
                            importes, totales, fechas, es_imagen, concepto, estado, subido_por, proyecto_id, texto)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'sin_match',$10,$11,$12)
     RETURNING *`,
    [
      proveedorClave, rutaBlob, nombreOriginal, numero,
      analisis.importes, analisis.totales, analisis.fechas.map(f => f.toISOString().slice(0, 10)),
      analisis.esImagen, concepto || null, subidoPor || null, proyectoId || null,
      analisis.texto || null,
    ]
  );
  const factura = { ...insert.rows[0], textoMayus: analisis.textoMayus };

  const resultado = await intentarMatch(factura);
  await aplicarEstado(factura.id, resultado);
  return resultado;
}

// Se llama tras importar/actualizar un excel del banco: reintenta el match de
// todas las facturas del flujo principal que se quedaron sin resolver
// (incluidas las subidas sueltas, sin proveedor, antes de que existiera el excel).
async function reintentarPendientes() {
  const { rows: pendientes } = await query(
    `SELECT * FROM facturas WHERE trimestre_id IS NULL AND estado IN ('sin_match', 'revisar') AND es_imagen = false`
  );
  let resueltas = 0;
  for (const factura of pendientes) {
    const resultado = await intentarMatch(factura);
    await aplicarEstado(factura.id, resultado);
    if (resultado.tipo === 'match_directo') resueltas++;
  }
  return { revisadas: pendientes.length, resueltas };
}

// A diferencia de reintentarPendientes (que solo reintenta el match con lo ya
// guardado), esto vuelve a descargar y leer el PDF de una factura sin
// resolver -- para cuando se corrige el regex de lectura o un bug de
// matching y se quedó mal por eso, no por falta de movimientos. Una factura
// a la vez (no todas de golpe) para que la pantalla pueda mostrar progreso
// real en vez de un único POST largo y ciego.
async function reprocesarFactura(facturaId) {
  const { rows: previas } = await query(`SELECT ruta_blob, nombre_original FROM facturas WHERE id = $1`, [facturaId]);
  if (previas.length === 0) throw new Error('Factura no encontrada.');
  const { ruta_blob: rutaBlob, nombre_original: nombreOriginal } = previas[0];
  const esPdf = /\.pdf$/i.test(nombreOriginal || '');

  const buffer = await descargarBlob(rutaBlob);
  const analisis = await analizarBuffer(buffer, esPdf);

  await asegurarColumnasMotivo();
  const { rows } = await query(
    `UPDATE facturas SET importes = $1, totales = $2, fechas = $3, texto = $5
     WHERE id = $4 RETURNING *`,
    [analisis.importes, analisis.totales, analisis.fechas.map(d => d.toISOString().slice(0, 10)), facturaId,
     analisis.texto || null]
  );
  const factura = { ...rows[0], textoMayus: analisis.textoMayus };
  const resultado = await intentarMatch(factura);
  await aplicarEstado(factura.id, resultado);
  return resultado;
}

// Solo rellena el texto de las facturas que no lo tengan. NO vuelve a cruzar
// nada: reprocesar una factura ya emparejada la haría buscar otra línea del
// banco y podría reasignarla. Aquí solo se baja el archivo, se lee y se
// guarda lo que pone.
async function guardarTextosFaltantes(limite = 200) {
  await asegurarColumnasMotivo();
  const { rows } = await query(
    `SELECT id, numero, ruta_blob, nombre_original FROM facturas
     WHERE texto IS NULL AND ruta_blob IS NOT NULL
     ORDER BY numero LIMIT $1`, [limite]
  );
  const resultado = { total: rows.length, guardadas: 0, sinTexto: 0, fallos: [] };
  for (const f of rows) {
    try {
      const buffer = await descargarBlob(f.ruta_blob);
      const analisis = await analizarBuffer(buffer, /\.pdf$/i.test(f.nombre_original || ''));
      if (!analisis.texto) { resultado.sinTexto++; continue; }
      await query(`UPDATE facturas SET texto = $2 WHERE id = $1`, [f.id, analisis.texto]);
      resultado.guardadas++;
    } catch (err) {
      resultado.fallos.push({ numero: f.numero, error: err.message });
    }
  }
  return resultado;
}

// Lee una factura con IA y devuelve lo que ha leído, SIN escribir nada ni
// volver a cruzar. Sirve para comprobar que la lectura funciona -- y para
// saber si la clave de Anthropic está configurada -- sin arriesgarse a que
// una factura ya emparejada acabe colgando de un segundo movimiento.
async function probarLecturaConIA(facturaId) {
  const { rows } = await query(
    `SELECT numero, ruta_blob, nombre_original FROM facturas WHERE id = $1`, [facturaId]
  );
  if (rows.length === 0) throw new Error('Factura no encontrada.');
  const { numero, ruta_blob: rutaBlob, nombre_original: nombreOriginal } = rows[0];
  const buffer = await descargarBlob(rutaBlob);
  const ia = await leerFacturaConIA(buffer, /\.pdf$/i.test(nombreOriginal || ''), nombreOriginal);
  return { numero, archivo: nombreOriginal, ...ia };
}

// Como reprocesarFactura, pero como último recurso: en vez del regex, le pasa
// el PDF/imagen tal cual a un modelo de IA para que lea el importe, la fecha
// y el proveedor. Deliberadamente NO se llama automáticamente desde
// reprocesarFactura ni al subir — tiene coste (aunque pequeño), así que es un
// botón aparte que la usuaria activa a mano, después de haber probado ya el
// recálculo normal (gratis) y seguir sin importe.
async function reprocesarFacturaConIA(facturaId) {
  const { rows: previas } = await query(`SELECT ruta_blob, nombre_original FROM facturas WHERE id = $1`, [facturaId]);
  if (previas.length === 0) throw new Error('Factura no encontrada.');
  const { ruta_blob: rutaBlob, nombre_original: nombreOriginal } = previas[0];
  const esPdf = /\.pdf$/i.test(nombreOriginal || '');

  const buffer = await descargarBlob(rutaBlob);
  const ia = await leerFacturaConIA(buffer, esPdf, nombreOriginal);

  const analisis = ia.ok
    ? {
        importes: [ia.importe],
        totales: [ia.importe],
        fechas: ia.fecha ? [new Date(ia.fecha)] : [],
        textoMayus: `IA: leída${ia.proveedor ? ` — proveedor: ${ia.proveedor}` : ''}.`,
      }
    : { importes: [], totales: [], fechas: [], textoMayus: `IA: no se ha podido leer (${ia.error})` };

  const { rows } = await query(
    `UPDATE facturas SET importes = $1, totales = $2, fechas = $3
     WHERE id = $4 RETURNING *`,
    [analisis.importes, analisis.totales, analisis.fechas.map(d => d.toISOString().slice(0, 10)), facturaId]
  );
  const factura = { ...rows[0], textoMayus: analisis.textoMayus };
  const resultado = await intentarMatch(factura);
  await aplicarEstado(factura.id, resultado);
  return resultado;
}

// Ids de las facturas del flujo principal a las que aplica reprocesarFactura
// -- para que la pantalla sepa qué lista recorrer, una a una, con progreso.
async function listarFacturasSinResolver() {
  const { rows } = await query(
    `SELECT id FROM facturas WHERE trimestre_id IS NULL AND estado IN ('sin_match', 'revisar') AND es_imagen = false`
  );
  return rows.map(r => r.id);
}

// Facturas a las que de verdad les haría falta la IA: sin ningún importe
// reconocido todavía (sea imagen o PDF ilegible) — a diferencia de
// listarFacturasSinResolver, esta SÍ incluye las imágenes (para eso es la
// IA) y excluye las que ya tienen importe pero no encajan con ningún
// movimiento (ahí la IA no puede ayudar, el dato ya se sabe).
async function listarFacturasSinImporte() {
  const { rows } = await query(
    `SELECT id FROM facturas
     WHERE trimestre_id IS NULL AND estado != 'matcheada'
       AND (totales IS NULL OR array_length(totales, 1) IS NULL)
       AND (importes IS NULL OR array_length(importes, 1) IS NULL)`
  );
  return rows.map(r => r.id);
}

// Fija a mano el importe de una factura que no se pudo leer del PDF (imagen,
// tabla ilegible, divisa rara...) y relanza el mismo matching automático que
// se usa al subir — evita tener que buscar la línea a mano en la tabla.
async function confirmarImporteManual(facturaId, importe) {
  const { rows } = await query(
    `UPDATE facturas SET importes = ARRAY[$2::numeric], totales = ARRAY[$2::numeric]
     WHERE id = $1 RETURNING *`,
    [facturaId, importe]
  );
  if (rows.length === 0) throw new Error('Factura no encontrada.');

  const factura = rows[0];
  const resultado = await intentarMatch(factura);
  await aplicarEstado(factura.id, resultado);
  return resultado;
}

// ALTER TABLE ... ADD COLUMN IF NOT EXISTS es barato e idempotente en
// Postgres -- se ejecuta como mucho una vez por arranque en frío de la
// función serverless (el flag evita repetirlo en cada llamada dentro de la
// misma instancia), sin depender de correr una migración a mano en producción.
let columnasMotivoAseguradas = false;
async function asegurarColumnasMotivo() {
  if (columnasMotivoAseguradas) return;
  await query(`ALTER TABLE facturas ADD COLUMN IF NOT EXISTS motivo_tipo TEXT`);
  await query(`ALTER TABLE facturas ADD COLUMN IF NOT EXISTS motivo_detalle TEXT`);
  await query(`ALTER TABLE facturas ADD COLUMN IF NOT EXISTS motivo_candidatos JSONB`);
  // El texto que se leyó del PDF. Antes se extraía, se sacaban los números y
  // se tiraba: cuando algo salía raro --por qué creyó que 17,69 era un total--
  // no había forma de mirarlo, ni entonces ni seis meses después. Solo
  // quedaban los números, sin el contexto que los explica.
  await query(`ALTER TABLE facturas ADD COLUMN IF NOT EXISTS texto TEXT`);
  columnasMotivoAseguradas = true;
}

// Como confirmarImporteManual, pero fija tambien la fecha de la factura --
// la fecha es la que desempata automaticamente cuando hay varias lineas
// pendientes con el mismo importe (ej. una cuota mensual).
// `soloGuardar` guarda los datos y no relanza el emparejamiento. Lo usa el
// guardado al salir del campo en la pantalla de Facturas: antes esos tres
// campos (concepto, fecha, importe) solo se guardaban al pulsar "Buscar", así
// que escribir y hacer clic fuera tiraba lo escrito. Guardar al salir es lo
// correcto, pero emparejar sola una factura porque has pasado por encima de
// un campo no lo es -- el emparejamiento se queda en el botón, a propósito.
async function confirmarDatosManual(facturaId, { importe, fecha, concepto, soloGuardar = false }) {
  const { rows } = await query(
    `UPDATE facturas SET
       importes = CASE WHEN $2::numeric IS NOT NULL THEN ARRAY[$2::numeric] ELSE importes END,
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

// Los candidatos de un caso "ambiguo"/"combo_sugerido" se guardan tal cual
// (no solo el texto del motivo) -- si no, se pierden en cuanto termina esta
// llamada y la pantalla no tiene con qué pintar los botones para elegir cuál
// es, aunque reintentarPendientes (subida de excel, "Recalcular") ya los haya
// calculado. Mismo problema/solución que datos_originales.larpmanager_candidatos.
function candidatosParaGuardar(resultado) {
  if (resultado.tipo === 'ambiguo') return { candidatos: resultado.candidatos };
  if (resultado.tipo === 'combo_sugerido') {
    return {
      movimientoId: resultado.movimientoId,
      otrasFacturas: resultado.otrasFacturas,
      detalle: resultado.detalle,
      // Se guarda si cuadra exacto y cuánto se desvía, para poder avisarlo
      // también donde no cabe la frase entera (la píldora de Movimientos).
      exacto: resultado.exacto,
      diferencia: resultado.diferencia,
    };
  }
  return null;
}

async function aplicarEstado(facturaId, resultado) {
  await asegurarColumnasMotivo();
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

// Confirmación manual de un caso ambiguo o de combinación sugerida.
async function confirmarMatch(movimientoId, facturaIds, notaFinal) {
  await resolverMovimiento(movimientoId, notaFinal, facturaIds);
  await query(
    `UPDATE facturas SET estado = 'matcheada' WHERE id = ANY($1::bigint[])`,
    [facturaIds]
  );
}

module.exports = {
  procesarFacturaSubida, confirmarMatch, confirmarImporteManual, confirmarDatosManual, reintentarPendientes,
  reprocesarFactura, reprocesarFacturaConIA, listarFacturasSinResolver, listarFacturasSinImporte,
  siguienteNumero, asegurarColumnasMotivo, guardarTextosFaltantes, probarLecturaConIA,
};
