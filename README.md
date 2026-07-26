# Punteo trimestral

Sistema para acelerar el punteo de facturas de gastos contra el extracto bancario (bbva, openbank, paypal) cada trimestre, antes de mandarlo a la gestoría. Solo cubre gastos — ingresos y devoluciones de tickets quedan fuera a propósito.

## Cómo funciona

No adivina proveedores por su cuenta: **aprende de tus propias anotaciones**. Cuanto más completes, más reconoce. Agrupa por proveedor (no línea a línea) para que confirmar un proveedor conocido sea una sola acción, y cruza el importe de cada factura que subes contra las líneas pendientes de ese proveedor — incluida la detección de que dos facturas juntas sumen el importe de una línea.

## Webapp (uso normal)

La forma de trabajar el día a día: subes el excel del banco, el sistema te dice qué proveedores necesitan factura, y vas subiendo facturas (incluso haciendo la foto desde el móvil en el momento de comprar) a medida que las consigues — la sesión persiste entre visitas, no hace falta terminar de una vez.

Ver [DEPLOY.md](DEPLOY.md) para desplegarla (GitHub privado + Vercel + Neon Postgres + Vercel Blob).

## Herramientas de línea de comandos

El motor original, útil para procesar un excel ya completo de una sola vez sin pasar por la webapp (por ejemplo, para revisar o depurar el matching).

- `node aprender.cjs <excel_completado.xlsx>` — memoriza las notas que ya escribiste en un trimestre cerrado.
- `node clasificar.cjs <entrada.xlsx> <salida.xlsx>` — añade columnas de sugerencia por proveedor conocido.
- `node matchear.cjs <entrada.xlsx> <carpeta_facturas> <salida.xlsx>` — cruza contra una carpeta local de facturas ya numeradas.
- `node puntear.cjs <entrada.xlsx> <carpeta_facturas> <salida.xlsx>` — hace ambas cosas en un solo paso.

`salida.xlsx` añade las columnas de sugerencia/candidata sin tocar tus columnas originales; revisa también la pestaña "Resumen" que se añade al final.

## Archivos

- `memoria_proveedores.json` — lo aprendido con las herramientas CLI. La webapp usa su propia copia en Postgres (ver `npm run migrar-memoria` en [DEPLOY.md](DEPLOY.md) para trasladar lo aprendido aquí).
- `config/sheets.json` — en qué columna está el concepto, el importe, la fecha y la nota manual de cada pestaña. Edítalo si BBVA/Openbank/PayPal cambian el formato de exportación.
- `db/schema.sql` — esquema de la base de datos de la webapp.

## Instalación (solo la primera vez)

```bash
npm install
```
