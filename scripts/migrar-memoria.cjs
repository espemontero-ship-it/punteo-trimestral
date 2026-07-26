// Migra memoria_proveedores.json (usado por los scripts CLI) a la tabla
// memoria_proveedores de Postgres. Ejecutar una vez, con DATABASE_URL apuntando
// a la base de Neon ya creada.
const fs = require('fs');
const path = require('path');
const { query, getPool } = require('../lib/db.cjs');

async function main() {
  const jsonPath = path.join(__dirname, '..', 'memoria_proveedores.json');
  if (!fs.existsSync(jsonPath)) {
    console.error('No se encontró memoria_proveedores.json en la raíz del proyecto.');
    process.exit(1);
  }
  const memoria = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

  let insertadas = 0;
  for (const [hoja, claves] of Object.entries(memoria)) {
    for (const [clave, entrada] of Object.entries(claves)) {
      for (const [nota, veces] of Object.entries(entrada.notas || {})) {
        await query(
          `INSERT INTO memoria_proveedores (hoja, clave, nota, veces)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (hoja, clave, nota) DO UPDATE SET veces = EXCLUDED.veces`,
          [hoja, clave, nota, veces]
        );
        insertadas++;
      }
    }
  }

  console.log(`Migradas ${insertadas} combinaciones hoja/clave/nota a Postgres.`);
  await getPool().end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
