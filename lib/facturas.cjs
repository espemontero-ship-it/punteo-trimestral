const fs = require('fs');
const path = require('path');
// pdf-parse v1 (no v2): la v2 arrastra pdfjs-dist con dependencias de canvas
// de navegador (DOMMatrix, ImageData...) que revientan en el runtime
// serverless de Vercel. v1 es un extractor de texto puro para Node.
const pdfParse = require('pdf-parse');

const RE_NOMBRE = /^(\d+)\.(pdf|jpg|jpeg|png)$/i;
// Número en formato español (punto de miles, coma decimal) o internacional
// (coma de miles, punto decimal) — muchas facturas de proveedores extranjeros
// (OpenAI, Mailchimp, Printify, AliExpress...) usan punto decimal, no coma.
const NUM_ES = String.raw`\d{1,3}(?:\.\d{3})*,\d{2}`;
const NUM_INTL = String.raw`\d{1,3}(?:,\d{3})*\.\d{2}`;
const NUM = `(?:${NUM_ES}|${NUM_INTL})`;
// (?!\w) en vez de \b tras EUR/USD: \b falla si el símbolo/palabra de moneda
// está seguido de un espacio o fin de texto, porque € no es un carácter de
// "palabra" y \b no marca límite entre dos no-palabras.
const SIMBOLO = String.raw`(?:€|\$|EUR(?!\w)|USD(?!\w))`;
const RE_MONEDA = new RegExp(`(${NUM})\\s*${SIMBOLO}|${SIMBOLO}\\s*(${NUM})`, 'gi');
// Mismo número pero sin moneda pegada — solo se usa como último recurso en
// líneas que ya parecen ser el total (ej. "TOTAL A PAGAR ... 45,00" con el
// € en otra columna del PDF, que al extraer el texto queda separado).
const RE_NUMERO_SOLO = new RegExp(NUM, 'g');
const RE_LINEA_TOTAL = /\b(total|importe|a pagar|total factura|balance)\b/i;
const RE_FECHA = /\b(\d{2})[\/\-](\d{2})[\/\-](\d{4})\b/g;

// El separador decimal (coma en formato español, punto en internacional) es
// el último de los dos símbolos presentes en el número — el otro, si lo hay,
// es el separador de miles y se descarta.
function parseImporte(raw) {
  const limpio = raw.trim();
  const ultimaComa = limpio.lastIndexOf(',');
  const ultimoPunto = limpio.lastIndexOf('.');
  if (ultimoPunto > ultimaComa) return parseFloat(limpio.replace(/,/g, ''));
  return parseFloat(limpio.replace(/\./g, '').replace(',', '.'));
}

// Ventana de caracteres hacia atrás en la que se busca "total"/"importe"
// para decidir si un número encontrado es el total de la factura.
const VENTANA_TOTAL = 40;

function extraerCandidatos(texto) {
  const importes = new Set();
  const totales = new Set();

  // Se busca en el texto entero con los saltos de línea colapsados a
  // espacios, no línea a línea — en muchos PDF de tablas, el número y el
  // símbolo de moneda (o el número y la palabra "TOTAL") quedan en líneas
  // distintas al extraer el texto, aunque visualmente estén juntos.
  const plano = texto.replace(/\s+/g, ' ');

  const reMoneda = new RegExp(RE_MONEDA.source, 'gi');
  let m;
  while ((m = reMoneda.exec(plano)) !== null) {
    const raw = m[1] || m[2];
    const v = parseImporte(raw);
    if (isNaN(v) || v <= 0) continue;
    const redondeado = Math.round(v * 100) / 100;
    importes.add(redondeado);
    const ventana = plano.slice(Math.max(0, m.index - VENTANA_TOTAL), m.index);
    if (RE_LINEA_TOTAL.test(ventana)) totales.add(redondeado);
  }

  // Sin moneda pegada pero cerca de "total" (p.ej. el símbolo € cayó en otra
  // celda de la tabla y ni el colapso de espacios lo junta): coger el
  // número igualmente si "total"/"importe" aparece justo antes.
  const reNum = new RegExp(RE_NUMERO_SOLO.source, 'g');
  while ((m = reNum.exec(plano)) !== null) {
    const v = parseImporte(m[0]);
    if (isNaN(v) || v <= 0) continue;
    const ventana = plano.slice(Math.max(0, m.index - VENTANA_TOTAL), m.index);
    if (!RE_LINEA_TOTAL.test(ventana)) continue;
    const redondeado = Math.round(v * 100) / 100;
    importes.add(redondeado);
    totales.add(redondeado);
  }

  const fechas = [];
  RE_FECHA.lastIndex = 0;
  while ((m = RE_FECHA.exec(texto)) !== null) {
    const [, d, mo, y] = m;
    const dt = new Date(`${y}-${mo}-${d}`);
    if (!isNaN(dt.getTime())) fechas.push(dt);
  }
  return { importes: [...importes], totales: [...totales], fechas };
}

// Analiza un buffer de factura ya en memoria (venga de un archivo local o de
// una subida a Vercel Blob) y extrae importes/fechas/texto. Punto único usado
// tanto por el escaneo de carpeta (CLI) como por la subida directa (webapp).
async function analizarBuffer(buffer, esPdf) {
  if (!esPdf) {
    return { esImagen: true, importes: [], totales: [], fechas: [], textoMayus: '' };
  }
  try {
    const resultado = await pdfParse(buffer);
    const { importes, totales, fechas } = extraerCandidatos(resultado.text);
    return {
      esImagen: false, importes, totales, fechas,
      textoMayus: resultado.text.toUpperCase().slice(0, 3000),
    };
  } catch (err) {
    return { esImagen: false, importes: [], totales: [], fechas: [], textoMayus: '', error: err.message };
  }
}

async function leerCarpetaFacturas(carpeta) {
  const archivos = fs.readdirSync(carpeta).filter(f => RE_NOMBRE.test(f));
  const facturas = {};

  for (const nombre of archivos) {
    const [, numero, ext] = nombre.match(RE_NOMBRE);
    const rutaCompleta = path.join(carpeta, nombre);
    const esPdf = /pdf/i.test(ext);
    const buf = fs.readFileSync(rutaCompleta);
    const analisis = await analizarBuffer(buf, esPdf);
    facturas[numero] = { numero, archivo: nombre, ...analisis };
  }
  return facturas;
}

function montoCaracteristico(factura) {
  if (factura.totales && factura.totales.length) return Math.max(...factura.totales);
  if (factura.importes && factura.importes.length) return Math.max(...factura.importes);
  return null;
}

module.exports = { leerCarpetaFacturas, extraerCandidatos, montoCaracteristico, analizarBuffer };
