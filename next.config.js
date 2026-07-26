/** @type {import('next').NextConfig} */
const nextConfig = {
  // pdf-parse se deja fuera de esta lista a propósito: como módulo "externo"
  // Turbopack lo carga con su propio require() en un momento que no respeta
  // el polyfill de DOMMatrix de lib/facturas.cjs. Empaquetado normal sí lo respeta.
  serverExternalPackages: ['exceljs'],
};

export default nextConfig;
