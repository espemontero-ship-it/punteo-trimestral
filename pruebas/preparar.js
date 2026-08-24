import fs from 'fs';

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
