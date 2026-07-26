# Desplegar la webapp

Todo el código está construido y probado localmente (build de producción limpio, login con contraseña + cookie firmada verificado end-to-end, motor de clasificación/matching verificado contra tus datos reales). Lo único que falta son pasos que solo tú puedes hacer porque requieren iniciar sesión en tus cuentas.

## 1. Repo privado en GitHub

```bash
git init
git add .
git commit -m "Punteo trimestral: motor CLI + webapp"
```

Crea un repositorio **privado** en GitHub y súbelo:

```bash
git remote add origin https://github.com/<tu-usuario>/punteo-trimestral.git
git push -u origin main
```

## 2. Conectar a Vercel

En [vercel.com](https://vercel.com) → **Add New → Project** → importa el repo. Vercel detecta Next.js automáticamente, no hay que tocar la configuración de build.

## 3. Añadir Postgres (Neon) y Blob

Desde el dashboard del proyecto en Vercel → pestaña **Storage**:
- **Create Database → Postgres (Neon)** — esto añade automáticamente `DATABASE_URL` (o `POSTGRES_URL`) a las variables de entorno del proyecto.
- **Create Database → Blob** — añade `BLOB_STORE_ID` y `BLOB_WEBHOOK_PUBLIC_KEY`. No hace falta ningún `BLOB_READ_WRITE_TOKEN`: la app se autentica con OIDC (el token corto que Vercel inyecta solo en Production/Preview), usando el patrón moderno `handleUploadPresigned`/`uploadPresigned` en vez del antiguo `handleUpload`.

## 4. Variables de entorno propias

En **Settings → Environment Variables**, añade:

| Variable | Valor |
|---|---|
| `AUTH_PASSWORD` | La contraseña que quieras usar para entrar |
| `AUTH_SECRET` | Una cadena aleatoria larga (ej. genera una con `openssl rand -hex 32`) |

## 5. Crear las tablas

Con `DATABASE_URL` ya configurado (cópialo del dashboard de Vercel a tu `.env.local` para este paso puntual, o usa el editor SQL de Neon directamente):

```bash
psql "$DATABASE_URL" -f db/schema.sql
```

(o pega el contenido de `db/schema.sql` en el editor SQL del dashboard de Neon).

## 6. Migrar lo ya aprendido

```bash
DATABASE_URL="..." npm run migrar-memoria
```

Esto carga `memoria_proveedores.json` (lo aprendido de tus trimestres anteriores con las herramientas de línea de comandos) en la base de datos, para que la webapp ya reconozca tus proveedores habituales desde el primer día.

## 7. Deploy

Cualquier `git push` a `main` despliega automáticamente. El primer deploy debería quedar listo en cuanto añadas las variables de entorno.

## 8. Probar

1. Entra a la URL de Vercel desde el PC, mete la contraseña.
2. Entra desde el móvil con la misma URL y contraseña — debe verse el mismo estado.
3. Escribe un identificador de trimestre (ej. `2026-Q3`) y sube el excel del banco.
4. Comprueba que el checklist de proveedores aparece agrupado y ya reconoce los habituales (gracias a la memoria migrada).
5. Desde el móvil, prueba a subir la foto de una factura real y comprueba que se matchea o se marca para revisar.
6. Al terminar, usa "Cerrar trimestre" y comprueba que el `.zip` descargado trae las facturas numeradas y el excel con las notas escritas.

## Nota sobre el excel de PayPal

`config/sheets.json` asume que el excel combinado tiene las tres pestañas nombradas exactamente `bbva`, `openbank` y `paypal` (como tu `2026.xlsx` actual). Si algún trimestre subes un export suelto de un solo banco, la pestaña de subida en la webapp te deja indicar a qué hoja corresponde.
