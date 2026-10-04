import fs from 'fs';
import { createRequire } from 'module';
import { afterAll } from 'vitest';
import { arrancarBaseLocal } from './baseLocal.js';

const raiz = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
for (const linea of fs.readFileSync(`${raiz}/.env.local`, 'utf8').split(/\r?\n/)) {
  const m = linea.match(/^([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/);
  if (m) process.env[m[1]] = m[2];
}

const produccion = fs.existsSync(`${raiz}/.env`)
  ? (fs.readFileSync(`${raiz}/.env`, 'utf8').match(/^DATABASE_URL\s*=\s*"?(.*?)"?\s*$/m) || [])[1]
  : null;
if (produccion && process.env.DATABASE_URL === produccion) {
  throw new Error('PARADO: las pruebas están apuntando a la base de PRODUCCIÓN.');
}

let base = null;
if (process.env.PRUEBAS_EN_LA_NUBE !== '1') {
  base = await arrancarBaseLocal();
  process.env.DATABASE_URL = base.url;
  delete process.env.POSTGRES_URL;
}

delete process.env.ANTHROPIC_API_KEY;

const { asegurarEsquemaReembolso } = await import('../lib/lotes.cjs');
const { asegurarColumnasMotivo } = await import('../lib/facturaMatcher.cjs');
const { asegurarTablaRechazos } = await import('../lib/memoria.cjs');
const { asegurarColumnaLarpManager, asegurarTablaPagosLarpManager } = await import('../lib/larpmanager.cjs');
const { asegurarColumnasDevolucion } = await import('../lib/devoluciones.cjs');

await asegurarColumnasMotivo();
await asegurarEsquemaReembolso();
await asegurarTablaRechazos();
await asegurarColumnaLarpManager();
await asegurarTablaPagosLarpManager();
await asegurarColumnasDevolucion();

const { getPool } = await import('../lib/db.cjs');
const requerir = createRequire(import.meta.url);
const cerrar = async pool => { try { await pool.end(); } catch {} };
afterAll(async () => {
  await cerrar(getPool());
  await cerrar(requerir('../lib/db.cjs').getPool());
  if (base) await base.parar();
});
