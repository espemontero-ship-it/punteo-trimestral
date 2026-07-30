/** @type {import('next').NextConfig} */
const nextConfig = {
  // pdf-parse se deja fuera de esta lista a propósito: como módulo "externo"
  // Turbopack lo carga con su propio require() en un momento que no respeta
  // el polyfill de DOMMatrix de lib/facturas.cjs. Empaquetado normal sí lo respeta.
  // archiver también va aquí: carga sus plugins de compresión (zip-stream,
  // lazystream...) con require() dinámico que el bundle de Next rompe,
  // dando errores minificados sin sentido ("i is not a function") al generar
  // el .zip de cierre de trimestre.
  serverExternalPackages: ['exceljs', 'archiver'],
};

export default nextConfig;
