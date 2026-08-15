// Limpia texto de movimientos bancarios para obtener una "clave" estable
// que se repite entre trimestres aunque cambien números de tarjeta, fechas,
// códigos de pedido o referencias de mandato.
function normalizeKey(rawText, importe) {
  let t = (rawText || '').toUpperCase();
  const n = importe !== null && importe !== undefined && importe !== '' ? parseFloat(importe) : NaN;

  // Proveedores conocidos por palabra clave (ej. Amazon, Stripe): cada
  // movimiento trae un texto distinto (nº de pedido, referencia de pago...)
  // que los separaría en un grupo de 1 línea cada vez — se agrupan todos bajo
  // el proveedor real en vez de por el texto exacto. Va antes que la regla de
  // transferencias de abajo: un ingreso de Stripe es un proveedor de pagos
  // que se revisa aparte, no un "ingreso de tickets" genérico. Misma lista
  // que inferirProveedorPorTexto, ampliar ahí también si se añade uno nuevo.
  const proveedorConocido = inferirProveedorPorTexto(t);
  if (proveedorConocido) {
    return (!isNaN(n) && n >= 0 ? '+ ' : '- ') + proveedorConocido.toUpperCase();
  }

  // Transferencias recibidas (importe positivo, texto "TRANSFERENCIA(S) ..."
  // o, en BBVA, "ABONO POR TRANSFERENCIA A SU FAVOR RECIBIDA EN EUROS ...").
  // Cada una trae un nombre o referencia distinta (persona, cuota de
  // inscripción...) que las separaría en un grupo de 1 línea cada vez —
  // pero para el punteo son casi siempre lo mismo: ingresos de tickets, se
  // resuelven todas igual con una referencia a la pestaña de ingresos, así
  // que se agrupan juntas en vez de fragmentarse. Las transferencias
  // salientes (importe negativo, pagos a colaboradores/proveedores) no
  // entran aquí — cada una es un caso distinto que sí hay que mirar aparte.
  if (!isNaN(n) && n >= 0 && /^(ABONO POR )?TRANSFERENCIAS?\b/.test(t.trim())) {
    return '+ TRANSFERENCIAS RECIBIDAS (ingresos)';
  }

  // Cargos de impuestos/tributos: el NRC es una referencia alfanumérica
  // única por pago (mezcla letras y números, no la recorta la limpieza de
  // números de abajo), así que cada uno formaba su propio grupo de 1 línea.
  // Todos se resuelven igual (referencia a Hacienda), así que se agrupan.
  if (/TRIBUTOS\s+NRC\b/.test(t) || /CARGO POR PAGO DE IMPUESTOS/.test(t)) {
    return (!isNaN(n) && n >= 0 ? '+ ' : '- ') + 'CARGO POR PAGO DE IMPUESTOS (tributos)';
  }

  t = t.replace(/,?\s*CON LA TARJETA\s*:?\s*[\d*]+.*$/i, '');
  t = t.replace(/\bEL\s+\d{4}-\d{2}-\d{2}.*$/i, '');
  t = t.replace(/N[ºO]?\s*RECIBO\s*[\dA-Z ]+REF\.?\s*MANDATO\s*[\dA-Z]+.*/i, '');
  t = t.replace(/\*[A-Z0-9]{5,}\b/g, '');
  t = t.replace(/\bREM\s*\d+\b/gi, '');
  t = t.replace(/\bCOMERC\s*\d+\b/gi, '');
  t = t.replace(/\bPID\d+\b/gi, '');
  t = t.replace(/\b\d{6,}\b/g, '');
  t = t.replace(/[.,]/g, ' ');
  t = t.replace(/\s{2,}/g, ' ').trim();
  t = t.slice(0, 60);

  if (importe !== null && importe !== undefined && importe !== '') {
    const n = parseFloat(importe);
    if (!isNaN(n)) {
      t = (n >= 0 ? '+ ' : '- ') + t;
    }
  }
  return t;
}

const UMBRAL_CONFIANZA = 0.6;

// Clasifica una clave según su historial en la memoria de proveedores.
// entrada: { total, notas: {nota: count} } | undefined
// Devuelve una forma neutra que tanto el CLI (clasificarCore) como la webapp
// (agrupador) pueden interpretar cada uno a su manera. Solo mira si la nota
// más repetida cubre suficiente historial como para sugerirla — no intenta
// detectar si las notas parecen números de factura (eso no significaba nada
// realmente: el número era solo la referencia para encontrar el archivo de
// la factura en la carpeta, no una categoría del proveedor).
function clasificarClave(entrada) {
  if (!entrada) {
    return {
      categoria: 'nueva',
      sugerenciaNota: null,
      detalle: 'Sin historial. Clasifícalo y la próxima vez se reconocerá.',
    };
  }

  const [notaMasFrecuente, countMasFrecuente] = Object.entries(entrada.notas).sort((a, b) => b[1] - a[1])[0];
  const share = entrada.total ? countMasFrecuente / entrada.total : 0;

  if (share >= UMBRAL_CONFIANZA) {
    return {
      categoria: 'fija',
      sugerenciaNota: notaMasFrecuente,
      detalle: `Histórico consistente (${Math.round(share * 100)}% de ${entrada.total} veces).`,
    };
  }

  const top3 = Object.entries(entrada.notas).sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([n, c]) => `"${n}" (${c})`).join(', ');
  return {
    categoria: 'mixta',
    sugerenciaNota: null,
    detalle: `Revisar manualmente. Antes se usó: ${top3}.`,
  };
}

const STOPWORDS = new Set([
  'COMPRA', 'TARJETA', 'CON', 'LA', 'EL', 'EN', 'DE', 'DEL', 'EUROS', 'TRANSFERENCIA',
  'FAVOR', 'RECIBIDA', 'ABONO', 'INMEDIATA', 'CONCEPTO', 'PARA', 'SOBRE', 'REGULARIZACION',
]);

// Extrae palabras que probablemente identifiquen al proveedor (para acotar combinaciones).
function pistasProveedor(texto) {
  const tokens = (texto || '').toUpperCase().match(/[A-ZÁÉÍÓÚÑ]{4,}/g) || [];
  return [...new Set(tokens.filter(t => !STOPWORDS.has(t)))];
}

// Sugerencia de nombre corto de Proveedor por palabra clave en el concepto —
// independiente de la clave de agrupación, para que funcione aunque el mismo
// proveedor real dé lugar a conceptos/claves distintos entre sí (ej. varias
// compras de Amazon con textos diferentes). Se amplía a mano según vayan
// apareciendo más casos (ej. "si lleva Amazon, el proveedor es Amazon").
// Amazon usa un patrón (no un texto fijo) porque el banco a veces lo recorta
// a "AMAZN" (sin la O) al formatear la línea.
const PROVEEDORES_CONOCIDOS = [
  { patron: /AMAZ[O0]?N/, nombre: 'Amazon' },
  { patron: /STRIPE/, nombre: 'Stripe' },
  { patron: /ALIEXPRESS/, nombre: 'AliExpress' },
];

function inferirProveedorPorTexto(texto) {
  const t = (texto || '').toUpperCase();
  for (const { patron, nombre } of PROVEEDORES_CONOCIDOS) {
    if (patron.test(t)) return nombre;
  }
  return null;
}

// Fórmulas con las que el banco envuelve el nombre real del comercio. El
// nombre está dentro del concepto, solo hay que quitarles la envoltura.
const ENVOLTURA_BANCO = [
  /^REGULARIZACION COMPRA EN\s+/i,
  /^COMPRA EN\s+/i,
  /^PAGO CON TARJETA EN\s+/i,
  /^ADEUDO A SU CARGO\s+/i,
  /^RECIBO\s+/i,
];
const COLA_BANCO = [/[,\s]+CON LA TARJETA.*$/i, /\s*\*{3,}.*$/, /[,\s]+$/];

// ¡OJO! Esta función NO se puede usar dentro de normalizeKey. La clave de
// agrupación se calcula con inferirProveedorPorTexto, así que ampliar la
// detección de proveedores allí CAMBIA la clave de los movimientos — y como
// la memoria aprendida está indexada por clave, se quedaría toda huérfana de
// golpe. Ya pasó: el 2026-08-14 se encontraron 211 filas de memoria (de 229)
// apuntando a claves que ya no existían, con aprendizaje real dentro
// (Stripe x34, retrocesión x19...). Esto es SOLO para proponer un nombre de
// proveedor en pantalla, que la usuaria confirma con un clic.
function proveedorSugeridoDesdeClave(clave) {
  let t = String(clave || '').replace(/^[+-]\s*/, '').trim();
  const envuelto = ENVOLTURA_BANCO.some(p => p.test(t));
  if (!envuelto) return null;
  for (const p of ENVOLTURA_BANCO) if (p.test(t)) { t = t.replace(p, ''); break; }
  for (const c of COLA_BANCO) t = t.replace(c, '');
  // El banco repite el nombre a veces ("STRATO GMBH N STRATO GMBH").
  t = t.replace(/\s+/g, ' ').trim();
  const mitad = t.match(/^(.+?)\s+N\s+\1$/i);
  if (mitad) t = mitad[1];
  if (t.length < 3 || t.length > 32) return null;
  return t;
}

module.exports = { normalizeKey, pistasProveedor, clasificarClave, inferirProveedorPorTexto, proveedorSugeridoDesdeClave };
