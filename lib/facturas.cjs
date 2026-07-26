const fs = require('fs');
const path = require('path');
// pdf-parse v1 (no v2): la v2 arrastra pdfjs-dist con dependencias de canvas
// de navegador (DOMMatrix, ImageData...) que revientan en el runtime
// serverless de Vercel. v1 es un extractor de texto puro para Node.
const pdfParse = require('pdf-parse');

const RE_NOMBRE = /^(\d+)\.(pdf|jpg|jpeg|png)$/i;
const RE_MONEDA = /(\d{1,3}(?:\.\d{3})*,\d{2})\s*€|€\s*(\d{1,3}(?:\.\d{3})*,\d{2})/g;
const RE_FECHA = /\b(\d{2})[\/\-](\d{2})[\/\-](\d{4})\b/g;

function parseImporte(raw) {
  return parseFloat(raw.replace(/\./g, '').replace(',', '.'));
}

function extraerCandidatos(texto) {
  const importes = new Set();
  const totales = new Set();

  for (const linea of texto.split('\n')) {
    const esLineaTotal = /total/i.test(linea);
    let m;
    const re = new RegExp(RE_MONEDA.source, 'g');
    while ((m = re.exec(linea)) !== null) {
      const raw = m[1] || m[2];
      const v = parseImporte(raw);
      if (isNaN(v) || v <= 0) continue;
      const redondeado = Math.round(v * 100) / 100;
      importes.add(redondeado);
      if (esLineaTotal) totales.add(redondeado);
    }
  }

  const fechas = [];
  let m;
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
