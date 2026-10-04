import fs from 'fs';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

const raiz = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const MIGRACIONES_OBSOLETAS = ['migration_colaboradores.sql', 'migration_continuo.sql'];

export async function arrancarBaseLocal() {
  const db = await PGlite.create();
  await db.exec(fs.readFileSync(`${raiz}/db/schema.sql`, 'utf8'));
  const migraciones = fs.readdirSync(`${raiz}/db`)
    .filter(n => n.startsWith('migration_') && !MIGRACIONES_OBSOLETAS.includes(n))
    .sort();
  for (const archivo of migraciones) {
    await db.exec(fs.readFileSync(`${raiz}/db/${archivo}`, 'utf8'));
  }
  await db.exec(`
    INSERT INTO colaboradores (nombre, usuario, password_hash) VALUES ('Colaboradora base', 'base-pruebas', 'x');
    INSERT INTO proyectos (nombre) VALUES ('Proyecto base');
  `);

  const servidor = new PGLiteSocketServer({ db, port: 0, host: '127.0.0.1', maxConnections: 10 });
  await servidor.start();
  const puerto = servidor.server.address().port;

  return {
    url: `postgres://postgres:postgres@127.0.0.1:${puerto}/postgres?sslmode=disable`,
    parar: async () => {
      await servidor.stop();
      await db.close();
    },
  };
}
