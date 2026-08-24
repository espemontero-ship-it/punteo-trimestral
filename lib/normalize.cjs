function normalizeKey(rawText, importe) {
  let t = (rawText || '').toUpperCase();
  const n = importe !== null && importe !== undefined && importe !== '' ? parseFloat(importe) : NaN;

  const proveedorConocido = inferirProveedorPorTexto(t);
  if (proveedorConocido) {
    return (!isNaN(n) && n >= 0 ? '+ ' : '- ') + proveedorConocido.toUpperCase();
  }

  if (!isNaN(n) && n >= 0 && /^(ABONO POR )?TRANSFERENCIAS?\b/.test(t.trim())) {
    return '+ TRANSFERENCIAS RECIBIDAS (ingresos)';
  }

  if (/TRIBUTOS\s+NRC\b/.test(t) || /CARGO POR PAGO DE IMPUESTOS/.test(t)) {
    return (!isNaN(n) && n >= 0 ? '+ ' : '- ') + 'CARGO POR PAGO DE IMPUESTOS (tributos)';
  }

  if (/^ABONO EN LA TARJETA\b/.test(t.trim())) {
    const fecha = (t.match(/\bEL\s+(\d{4}-\d{2}-\d{2})/) || [])[1] || '';
    const signo = !isNaN(n) && n >= 0 ? '+ ' : '- ';
    const importeTexto = !isNaN(n) ? ` ${Math.abs(n).toFixed(2)}` : '';
    return `${signo}ABONO EN LA TARJETA${fecha ? ` ${fecha}` : ''}${importeTexto}`;
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

function pistasProveedor(texto) {
  const tokens = (texto || '').toUpperCase().match(/[A-ZÁÉÍÓÚÑ]{4,}/g) || [];
  return [...new Set(tokens.filter(t => !STOPWORDS.has(t)))];
}

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

const ENVOLTURA_BANCO = [
  /^REGULARIZACION COMPRA EN\s+/i,
  /^COMPRA EN\s+/i,
  /^PAGO CON TARJETA EN\s+/i,
  /^ADEUDO A SU CARGO\s+/i,
  /^RECIBO\s+/i,
];
const COLA_BANCO = [/[,\s]+CON LA TARJETA.*$/i, /\s*\*{3,}.*$/, /[,\s]+$/];

function proveedorSugeridoDesdeClave(clave) {
  let t = String(clave || '').replace(/^[+-]\s*/, '').trim();
  const envuelto = ENVOLTURA_BANCO.some(p => p.test(t));
  if (!envuelto) return null;
  for (const p of ENVOLTURA_BANCO) if (p.test(t)) { t = t.replace(p, ''); break; }
  for (const c of COLA_BANCO) t = t.replace(c, '');

  t = t.replace(/\s+/g, ' ').trim();
  const mitad = t.match(/^(.+?)\s+N\s+\1$/i);
  if (mitad) t = mitad[1];
  if (t.length < 3 || t.length > 32) return null;
  return t;
}

module.exports = { normalizeKey, pistasProveedor, clasificarClave, inferirProveedorPorTexto, proveedorSugeridoDesdeClave };
