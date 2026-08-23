const crypto = require('crypto');
const { query } = require('./db.cjs');
const { registrarNota } = require('./memoria.cjs');
const { descargarBlob, eliminarBlob } = require('./blob.cjs');
// Cuanto vale una factura: un unico sitio lo responde. Ver importeFactura.cjs.
const { importeDeFactura, centimosDeFactura, centimosDeCadaFactura, centimosDeMovimiento } = require('./importeFactura.cjs');
const { leerFacturaConIA } = require('./facturaIA.cjs');

// PROPONER SI, DAR POR BUENO NO.
//
// Todo se compara en centimos enteros. Cuadrar es cuadrar EXACTO: nada que no
// cuadre al centimo se presenta como que cuadra, y nada se empareja solo.
//
// Pero lo que se acerca SI se propone, hasta un euro de diferencia, diciendo
// siempre cuanto falta o cuanto sobra -- decidido asi por la usuaria: "no
// quiero que valide directamente, pero si que me lo proponga". El caso real:
// tres facturas que suman 194,44 EUR contra una linea de 194,22 EUR.
//
// Antes habia dos margenes escondidos (un centimo y cincuenta) que se
// aplicaban EN SILENCIO, sin decir que no cuadraba: por ahi entraron 124,74
// EUR dados por buenos contra una linea de 125,00 EUR.
const MARGEN_PARA_PROPONER = 100; // centimos

// Cuanto le falta a la factura para cuadrar con la linea, en centimos: en
// positivo si la linea es mayor (faltan), en negativo si sobra.
function desviacion(movimiento, centimosFactura) {
  return Math.abs(centimosDeMovimiento(movimiento)) - Math.abs(centimosFactura);
}

// El texto del aviso. Cuando cuadra al centimo no se dice nada, que es lo
// normal; el aviso es para el error.
function avisoDeDesvio(centimos) {
  if (centimos === 0) return '';
  return ` NO CUADRA: ${centimos > 0 ? 'faltan' : 'sobran'} ${(Math.abs(centimos) / 100).toFixed(2)}€. Compruébalo antes de aceptar.`;
}

// Cuántas facturas sueltas se prueban combinadas como máximo -- más allá de
// esto el número de combinaciones crece muy rápido y el riesgo de un
// falso positivo (una suma que cuadra por casualidad) también.
const MAX_FACTURAS_EN_COMBO = 3;

// Ninguna factura lleva ya trimestre: lo que distingue a las que paga un
// colaborador es tener lote (ver lib/lotes.cjs).
// UNA sola numeración para todas las facturas, las tuyas y las de
// colaboradores. Antes había dos secuencias independientes (la principal iba
// 1,2,3... y la de lotes por su cuenta), lo que hacía imposible referirse a
// una factura por su número sin decir además de cuál de las dos hablabas --
// y las de colaborador ni siquiera llegaban al paquete de la gestoría.
// Los huecos no importan: una factura que se sube y luego se rechaza se lleva
// su número y ese número no aparecerá en el zip. Se prefiere eso a renumerar
// al enviar, que cambiaría un número que el colaborador ya ha visto.
// El numero lo reparte la BASE DE DATOS, con una secuencia. Antes era "el
// numero mas alto + 1", que es la forma que falla: dos subidas a la vez leen
// el mismo maximo y cogen el mismo numero. Con varias subidas simultaneas
// desde tres pantallas, eso deja de ser raro.
//
// La secuencia arranca donde este la numeracion actual, para no repetir
// ninguno de los que ya existen.
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
async function movimientosPendientes(proveedorClave, centimosFactura) {
  // El signo manda. Una factura normal (positiva) justifica dinero que SALE,
  // asi que se miran los gastos. Una rectificativa (negativa) justifica dinero
  // que ENTRA, asi que se miran los ingresos.
  //
  // Antes se miraban SIEMPRE los gastos y se comparaba en valor absoluto: una
  // rectificativa no encontraba su linea nunca, y un ingreso de +125 EUR
  // parecia un gasto de 125 EUR -- en produccion se emparejaron dos facturas
  // de compra contra la transferencia de la inscripcion de una jugadora.
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
// Limitado a lote_id IS NULL (facturas del flujo principal, no de lote): lo
// que paga un colaborador no salió de la cuenta, así que no se cruza.
async function facturasSinResolver(proveedorClave, excluirId) {
  const { rows } = await query(
    proveedorClave
      ? `SELECT id, numero, totales, fechas FROM facturas
         WHERE lote_id IS NULL AND proveedor_clave = $1 AND estado IN ('sin_match', 'revisar') AND id != $2`
      : `SELECT id, numero, totales, fechas FROM facturas
         WHERE lote_id IS NULL AND proveedor_clave IS NULL AND estado IN ('sin_match', 'revisar') AND id != $1`,
    proveedorClave ? [proveedorClave, excluirId] : [excluirId]
  );
  return rows;
}


// Un mismo PDF puede traer VARIAS facturas dentro (Amazon manda una por
// vendedor cuando un pedido lleva productos de varios). Lo normal es que el
// banco las cobre juntas, y para eso ya vale el importe del archivo, que es la
// suma de todas. Esto es para el otro caso: que cobrara SOLO ALGUNAS.
//
// Se prueban las combinaciones de dos, tres y cuatro. Todo en centimos
// enteros, para no arrastrar el ruido de los decimales.
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

// El movimiento con el que ya está emparejada una factura, con TODAS las
// facturas que lo justifican y lo que suman entre ellas. Devuelve null si no
// está emparejada.
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

// Intenta emparejar una factura ya guardada (con o sin proveedor asignado)
// contra los movimientos pendientes de todo el histórico. Nunca resuelve nada
// ambiguo sola.
async function intentarMatch(factura) {
  const { id: facturaId, numero, proveedor_clave: proveedorClave, fechas, concepto } = factura;

  const monto = importeDeFactura(factura);

  // SI YA ESTÁ EMPAREJADA, ESTO ES UNA REVISIÓN, NO UN CRUCE.
  //
  // Si el emparejamiento es correcto no hay nada que hacer; si no cuadra, se
  // avisa. Lo que nunca puede pasar es que se busque otro movimiento y la
  // factura acabe colgando de dos, que es lo que hacía antes: volver a leer
  // una factura ya emparejada la mandaba a buscar línea otra vez.
  //
  // Se comprueban TODAS las facturas pegadas a ese movimiento, no solo esta:
  // si el movimiento se justificó con un combo, una sola nunca cuadra con el
  // importe entero.
  const yaEmparejada = await emparejamientoDe(facturaId);
  if (yaEmparejada) {
    const { movimiento, facturas, suma } = yaEmparejada;
    const dela = Math.abs(Number(movimiento.importe));
    // Al centimo, en enteros: cuadra o no cuadra, sin margen.
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

  // El aviso de "es imagen" solo tiene sentido mientras no se sepa el importe
  // -- si ya se ha fijado a mano (o vinculado manualmente), monto no es null
  // y hay que seguir e intentar el match, no repetir algo que la usuaria ya
  // sabe y por lo que precisamente acaba de escribir el importe.
  // Sin importe: la factura se queda asi y lo escribe ella a mano. Ya no hay
  // caso especial para las fotos -- la IA las lee igual que un PDF-- ni se
  // ensena un trozo del texto extraido, porque ya no hay lector de texto.
  if (monto === null) {
    return {
      tipo: 'sin_importe', numero, facturaId,
      detalle: 'No se ha reconocido el importe. Escríbelo a mano en la columna Importe.',
    };
  }

  // LAS QUE PAGA UN COLABORADOR DE SU BOLSILLO NO SE CRUZAN: de la cuenta no
  // sale esa factura, sale el reembolso que se le hace, que ademas suele
  // juntar varias. Cruzarlas solo puede encontrar coincidencias falsas.
  //
  // Lo que las distingue es QUIEN LAS PAGA (que pertenezcan a un lote), no
  // quien las sube. Mirar quien las sube estaba mal: la propia usuaria esta
  // dada de alta, asi que sus facturas llevan su nombre y quedaban todas
  // marcadas como "de un colaborador" y sin cruzar.
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

  // AL CENTIMO, sin margenes. Se comparan centimos enteros: la factura y la
  // linea tienen signos opuestos (una compra de +45 EUR se paga con una linea
  // de -45 EUR), asi que cuadran cuando suman cero.
  //
  // Antes habia un margen de un centimo aqui y de cincuenta en las
  // combinaciones. Ese margen es por donde entraban los emparejamientos que no
  // cuadraban.
  const candidatos = pendientes
    .map(m => ({ ...m, desvio: desviacion(m, centimos), dias: diasEntre(m.fecha, fechaFactura) }))
    .filter(c => Math.abs(c.desvio) <= MARGEN_PARA_PROPONER)
    .sort((a, b) => Math.abs(a.desvio) - Math.abs(b.desvio) || (a.dias ?? 9999) - (b.dias ?? 9999));

  // NADA SE EMPAREJA SOLO. Aunque encaje una sola linea, se propone y lo
  // confirma ella -- el mismo sistema que LarpManager. Antes, con una unica
  // linea que encajara, la app resolvia la linea, le escribia la nota y daba
  // la factura por emparejada sin preguntar.
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
  // El archivo trae varias facturas dentro y el banco las cobró juntas: se
  // prueban las sumas de sus totales.
  //
  // Esto NUNCA resuelve la línea solo, ni cuando cuadra con una única
  // pendiente: una suma es una conjetura, no un número impreso en la factura.
  // Con dos facturas dentro salen ya 29 sumas posibles, y alguna puede cuadrar
  // por casualidad con una línea que no es. Se propone y la confirma la
  // usuaria, igual que las combinaciones entre varios archivos.
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
    // Si encaja con UNA sola linea se propone como una combinacion, aunque las
    // facturas esten dentro del mismo archivo. Asi la propuesta se ve tambien
    // en Movimientos y no solo en Facturas: antes se guardaba como "ambiguo",
    // que esa pantalla no dibuja, y la linea parecia no tener nada -- justo lo
    // que paso con la de 43,78 EUR.
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

  // Sin match directo: probar combinación con otras facturas sin resolver.
  //
  // TODAS, no solo las del mismo proveedor. Antes se restringía por proveedor
  // cuando la factura lo tenía puesto, y no cuando no -- así que el mismo
  // archivo se comparaba con un conjunto u otro según un dato que no tiene
  // nada que ver con si dos gastos se cobraron juntos. El banco agrupa por
  // cargo, no por proveedor.
  const otras = await facturasSinResolver(null, facturaId)
    .then(rows => rows
      .map(o => ({ ...o, monto: importeDeFactura(o), centimos: centimosDeFactura(o) }))
      .filter(o => o.centimos !== null));

  // Se recogen las combinaciones que CUADRAN EXACTAS, y se elige la de menos
  // facturas. Antes se aceptaba hasta medio euro de desviacion y se proponia
  // "la que menos se desvie": ese margen es por donde entraron 124,74 EUR
  // dados por buenos contra una linea de 125,00 EUR.
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
  // Primero la que cuadre exacta; entre las que no, la que menos se desvie, y
  // a igualdad la de menos facturas.
  posibles.sort((a, b) => Math.abs(a.desvio) - Math.abs(b.desvio) || a.cuantas - b.cuantas);

  const mejor = posibles[0];
  if (mejor) {
    const { grupo, suma, match, desvio } = mejor;
    const otrasTexto = grupo.map(o => `la factura ${o.numero} (${o.monto.toFixed(2)}€)`).join(' + ');
    return {
      tipo: 'combo_sugerido', numero, facturaId, facturaConcepto: concepto,
      movimientoId: match.id, suma: suma / 100, exacto: desvio === 0, diferencia: desvio / 100,
      otrasFacturas: grupo.map(o => ({ id: o.id, numero: o.numero, monto: o.monto })),
      detalle: `Esta factura (${monto.toFixed(2)}€) + ${otrasTexto} suman ${(suma / 100).toFixed(2)}€, contra la línea de ${Math.abs(match.importe).toFixed(2)}€.${avisoDeDesvio(desvio)}`,
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
    return valores.some(v => Math.round(imp * 100) === Math.round(v * 100));
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

// ¿Este archivo exacto ya está subido? Se compara el CONTENIDO (sha256), no el
// nombre. El mismo PDF bajado dos veces del correo se llama "factura.pdf" y
// "factura (1).pdf", y por el nombre eran dos facturas distintas: se colaban
// duplicadas sin que nada avisara.
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

// Guarda una factura recién subida (flujo principal, no lote). `hoja`/`clave`
// son opcionales: si aún no existe el excel del banco (o no se sabe el
// proveedor), se sube sin asignar y se reintentará el match automáticamente
// cuando haya movimientos. No pertenece a ningún trimestre.
async function procesarFacturaSubida({ hoja, clave, rutaBlob, nombreOriginal, concepto, analisis, subidoPor, proyectoId }) {
  const proveedorClave = hoja && clave ? `${hoja}::${clave}` : null;
  const numero = await siguienteNumero();
  await asegurarColumnasMotivo();

  // Este archivo ya está subido: NO se guarda otra vez. Y se borra del almacén
  // el que se acaba de subir, para no dejarlo ahí ocupando sitio sin que
  // ninguna factura lo use.
  const yaSubida = await facturaConMismaHuella(analisis.huella);
  if (yaSubida) {
    try { await eliminarBlob(rutaBlob); } catch { /* si no se deja borrar, no bloquea */ }
    const cuando = yaSubida.creado_en ? new Date(yaSubida.creado_en).toLocaleDateString('es-ES') : null;
    return {
      tipo: 'duplicada',
      duplicada: { numero: yaSubida.numero, nombre: yaSubida.nombre_original, cuando },
      // Al colaborador no se le dice el número: esa numeración no es suya.
      detalle: subidoPor
        ? `This file was already uploaded${cuando ? ` on ${cuando}` : ''}. It has not been saved again.`
        : `Este archivo ya está subido como factura #${yaSubida.numero} (${yaSubida.nombre_original})${
            cuando ? `, subida el ${cuando}` : ''}. No se ha vuelto a guardar.`,
    };
  }

  const insert = await query(
    // Ya no se guardan el texto del PDF, lo que leyo el lector de texto, ni si
    // era una imagen: todo eso venia del lector que se ha borrado. Las columnas
    // siguen existiendo un tiempo, sin usarse, porque borrarlas no tiene vuelta
    // atras.
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
  // Si la IA no ha podido leer, se dice y se dice por que. La factura se queda
  // sin importe y se escribe a mano: ya no hay lector de repuesto que rellene
  // el hueco con un numero peor.
  if (analisis.leidoConIA === false && analisis.motivoIA) {
    resultado.detalle = `La IA no está funcionando (${analisis.motivoIA}), así que esta factura se ha guardado sin importe: escríbelo a mano. ${resultado.detalle || ''}`.trim();
  }
  await aplicarEstado(factura.id, resultado);
  return resultado;
}

// Se llama tras importar/actualizar un excel del banco: reintenta el match de
// todas las facturas del flujo principal que se quedaron sin resolver
// (incluidas las subidas sueltas, sin proveedor, antes de que existiera el excel).
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

// Por qué no ha leído la IA, dicho en cristiano. El error de la API es una
// parrafada en inglés con un id de petición dentro; lo que hace falta saber es
// si hay que meter saldo, avisar de que falta la clave, o si simplemente ese
// documento no se puede leer.
function porQueNoLeyoLaIA(error) {
  const e = String(error || '');
  if (/credit balance/i.test(e)) return 'la cuenta de Anthropic no tiene saldo';
  if (/ANTHROPIC_API_KEY/i.test(e)) return 'falta configurar la clave de Anthropic';
  if (/rate limit|429/i.test(e)) return 'la API de Anthropic está saturada ahora mismo';
  if (/no ha podido leer un importe/i.test(e)) return 'no ha sabido leer ningún importe en el documento';
  return e.slice(0, 120);
}

// `leer` es quien lee la factura. Por defecto la IA de verdad; se puede pasar
// otra cosa para poder probar esto sin llamar a la IA, que cuesta dinero y
// depende de internet. Es el unico punto por el que entra una lectura.
async function analizarFactura(buffer, esPdf, nombreOriginal, leer = leerFacturaConIA) {
  const huella = crypto.createHash('sha256').update(buffer).digest('hex');
  const ia = await leer(buffer, esPdf, nombreOriginal);

  // Si la IA no puede, la factura se guarda igual pero SIN importe, y se dice
  // por que. Antes rellenaba el hueco el lector de texto, que solo sabia
  // buscar numeros cerca de la palabra "total": confundia la base imponible
  // con el total, y cuando no podia leer el PDF dejaba la factura sin importe
  // machacando el que ya tenia. El 22/8/2026 vacio cuatro.
  if (!ia.ok) {
    return { huella, totales: [], fechas: [], leidoConIA: false, motivoIA: porQueNoLeyoLaIA(ia.error) };
  }

  const fechas = ia.facturas.map(f => f.fecha).filter(Boolean).map(f => new Date(f))
    .filter(d => !isNaN(d.getTime()));
  // Un total por cada factura del documento. El importe del archivo es su
  // suma, y eso lo responde importeFactura.cjs y solo el.
  const totales = ia.facturas.map(f => f.importe);
  return {
    huella,
    totales,
    fechas,
    leidoConIA: true,
    proveedorIA: ia.facturas.map(f => f.proveedor).filter(Boolean)[0] || null,
  };
}
// Fija a mano el importe de una factura que no se pudo leer del PDF (imagen,
// tabla ilegible, divisa rara...) y relanza el mismo matching automático que
// se usa al subir — evita tener que buscar la línea a mano en la tabla.
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
  // Qué leyó cada uno. La IA manda, pero se guarda también lo que sacó el
  // lector de texto para poder comparar: donde no coinciden está la lista de
  // sitios donde el regex falla, con el documento real detrás. Es la única
  // forma de arreglar sus patrones con datos en vez de con teorías.
  await query(`ALTER TABLE facturas ADD COLUMN IF NOT EXISTS lectura_regex JSONB`);
  await query(`ALTER TABLE facturas ADD COLUMN IF NOT EXISTS leido_con_ia BOOLEAN`);
  // Quién emite la factura, tal y como lo lee la IA. OJO: no confundir con
  // proveedor_clave, que es el grupo de movimientos del banco al que se
  // asignó. Este es el emisor del documento, y la IA ya lo leía -- se estaba
  // tirando.
  await query(`ALTER TABLE facturas ADD COLUMN IF NOT EXISTS proveedor TEXT`);
  // sha256 del archivo. Dos subidas del mismo PDF tienen la misma huella
  // aunque se llamen distinto, que es lo único que se miraba hasta ahora para
  // avisar de un duplicado.
  await query(`ALTER TABLE facturas ADD COLUMN IF NOT EXISTS huella TEXT`);
  await query(`CREATE INDEX IF NOT EXISTS idx_facturas_huella ON facturas(huella)`);
  // UNA FACTURA JUSTIFICA UN SOLO MOVIMIENTO. Un movimiento si puede tener
  // varias facturas, pero no al reves. La regla vive aqui, en la base, para
  // que sea imposible y no dependa de que el codigo se acuerde.
  await query(`CREATE UNIQUE INDEX IF NOT EXISTS movimiento_facturas_una_por_factura ON movimiento_facturas(factura_id)`);
  // El colaborador puede corregir el importe que leyo la IA; queda constancia
  // de que lo toco a mano.
  await query(`ALTER TABLE facturas ADD COLUMN IF NOT EXISTS importe_a_mano BOOLEAN NOT NULL DEFAULT false`);
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
  // Revisar una factura ya emparejada no le cambia el estado --sigue
  // emparejada-- pero sí tiene que poder dejar escrito el aviso de que no
  // cuadra. Con el UPDATE de abajo, que se salta las matcheadas, ese aviso se
  // perdía y la factura seguía diciendo que estaba perfecta.
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
  siguienteNumero, asegurarColumnasMotivo, analizarFactura,
  facturaConMismaHuella, importeDeFactura,
};
