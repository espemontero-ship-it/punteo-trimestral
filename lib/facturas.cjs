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
// Dos arreglos en la misma expresión, los dos comprobados contra una factura
// real de Amazon:
//   1. El punto como separador (19.07.2026), que usan Amazon y otros
//      proveedores europeos.
//   2. Sin \b delante: al extraer el texto de un PDF, la etiqueta y la fecha
//      quedan pegadas ("Fecha del pedido19.07.2026"), y entre "o" y "1" no
//      hay límite de palabra, así que \b hacía fallar la búsqueda entera. Es
//      el mismo problema que ya estaba documentado para los meses en letra.
//      Se sustituye por "que no venga precedida ni seguida de otro dígito",
//      que es lo que de verdad hace falta.
const RE_FECHA = /(?<!\d)(\d{2})[\/\-.](\d{2})[\/\-.](\d{4})(?!\d)/g;
// Facturas digitales (ej. exportadas de un sistema, no maquetadas a mano)
// suelen escribir la fecha en formato ISO (AAAA-MM-DD), que el regex de
// arriba (día primero) no reconoce.
const RE_FECHA_ISO = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
// Facturas de proveedores extranjeros (OpenAI, Stripe...) escriben la fecha
// con el mes en letra ("DECEMBER 10, 2025" o "10 DECEMBER 2025"), que el
// regex numérico de arriba no reconoce — sin fecha, el desempate automático
// entre varias líneas con el mismo importe (ej. la cuota mensual de un mismo
// proveedor) no tiene nada con qué comparar y todo cae en "ambiguo". Se
// incluyen también los nombres en español, porque la mayoría de proveedores
// reales de la asociación son españoles ("2 de agosto de 2026", "02 ago 2026").
const MESES = {
  jan: '01', january: '01', feb: '02', february: '02', mar: '03', march: '03',
  apr: '04', april: '04', may: '05', jun: '06', june: '06', jul: '07', july: '07',
  aug: '08', august: '08', sep: '09', sept: '09', september: '09', oct: '10', october: '10',
  nov: '11', november: '11', dec: '12', december: '12',
  ene: '01', enero: '01', febrero: '02', marzo: '03', abr: '04', abril: '04',
  mayo: '05', junio: '06', julio: '07', ago: '08', agosto: '08',
  setiembre: '09', septiembre: '09', octubre: '10',
  noviembre: '11', dic: '12', diciembre: '12',
};
// Nombres explícitos (no una clase [A-Z]{3,9} genérica) porque en muchos PDF
// la etiqueta y el mes quedan pegados sin espacio al extraer el texto (ej.
// "DATE OF ISSUEDECEMBER 10, 2025") — hace falta poder encontrar "DECEMBER"
// dentro de esa palabra más larga, no exigir un límite de palabra delante.
// Los nombres largos van antes que sus abreviaturas para que el motor de
// regex no pare en "jan" al toparse con "january".
const NOMBRES_MES = Object.keys(MESES).sort((a, b) => b.length - a.length).join('|');
const RE_FECHA_MES = new RegExp(
  `(?:(${NOMBRES_MES})\\s+(\\d{1,2}),?\\s+(\\d{4})|(\\d{1,2})\\s+de\\s+(${NOMBRES_MES})\\s+de\\s+(\\d{4})|(\\d{1,2})\\s+(${NOMBRES_MES})[,.]?\\s+(\\d{4}))`,
  'gi'
);

// Se mudó a lib/numero.cjs para que las pantallas puedan usar el mismo lector
// que la extracción de PDF -- antes tenían el suyo propio, y era peor.
const { parseImporte } = require('./numero.cjs');

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
  RE_FECHA_ISO.lastIndex = 0;
  while ((m = RE_FECHA_ISO.exec(texto)) !== null) {
    const [, y, mo, d] = m;
    const dt = new Date(`${y}-${mo}-${d}`);
    if (!isNaN(dt.getTime())) fechas.push(dt);
  }
  RE_FECHA_MES.lastIndex = 0;
  while ((m = RE_FECHA_MES.exec(texto)) !== null) {
    const [, mesA, diaA, anioA, diaEs, mesEs, anioEs, diaB, mesB, anioB] = m;
    const mesNombre = (mesA || mesEs || mesB).toLowerCase();
    const mesNum = MESES[mesNombre];
    if (!mesNum) continue;
    const dia = (diaA || diaEs || diaB).padStart(2, '0');
    const anio = anioA || anioEs || anioB;
    const dt = new Date(`${anio}-${mesNum}-${dia}`);
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
