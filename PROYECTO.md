# Punteo trimestral — hoja de proyecto

Este documento es la fuente de verdad del proyecto: qué es, qué decisiones se han tomado y por qué, y qué queda pendiente. Se actualiza cada vez que se toma una decisión de producto, alcance o diseño — no hace falta bucear en sesiones antiguas para reconstruirlo.

## Qué es y para quién

Aplicación para una asociación sin ánimo de lucro (carpeta de Drive: "NOT ONLY LARP" — administración). Cada trimestre hay que mandar a la gestoría el punteo del banco contra las facturas de gastos, para que preparen IVA, IRPF e IS.

Proceso manual que sustituye: bajar el excel del banco, subirlo a Drive, buscar cada factura a mano y relacionarla por número (las facturas se numeran para que el nombre del archivo coincida con la nota escrita en el excel, ej. `59 y 60` cuando una línea del banco cubre dos facturas juntas).

## Alcance — decisiones cerradas

- **Ingresos y devoluciones de tickets quedan fuera para siempre.** No es un "por ahora", es un límite permanente de alcance.
- **Sin IA/ML.** Todo determinista: regex + heurísticas sobre texto. Si algo falla, se puede ver exactamente por qué.
- **Sin OAuth de Google Drive.** Se lee una carpeta local sincronizada con Google Drive para escritorio — nunca se conecta la cuenta por API.
- **Agrupar por proveedor, no línea a línea.** Decisión explícita: revisar 380 líneas una a una, aunque cada una tenga una sugerencia, sigue siendo 380 decisiones — el ahorro real viene de actuar sobre el grupo entero de una vez.
- **El excel se sube cada vez, no hay ruta fija** — hay tres fuentes (bbva/openbank/paypal) que cambian cada trimestre.
- **Tiene que funcionar desde el móvil con cámara** (foto del recibo en el momento de comprar) — esto es lo que obligó a que fuera una webapp en la nube en vez de un script local.

## Cómo funciona

No adivina proveedores por su cuenta: aprende de las notas ya escritas en trimestres anteriores. Agrupa por proveedor (no línea a línea). Al subir una factura, la cruza automáticamente contra las líneas pendientes de ese proveedor, incluida la detección de que dos facturas juntas sumen el importe de una línea.

## Stack técnico (y por qué, no solo qué)

**Next.js + Neon Postgres (vía integración de Vercel) + Vercel Blob + GitHub privado**, desplegado en Vercel.

Alternativas descartadas, con motivo real:
- **Script local en Python** — descartado porque no había Python instalado y porque el requisito de móvil+cámara obliga a un servidor accesible desde cualquier sitio, no solo el PC.
- **STRATO Hosting Profesional** (el hosting que ya tenía la asociación) — es hosting compartido, sin Node.js ni acceso SSH. Solo su plan VPS/Node.js lo permitiría, que es un producto distinto y de más coste.
- **Supabase** — su plan gratuito limita a 2 proyectos activos por organización, y esa organización ya estaba al límite con otras apps.

## Funcionalidades construidas, en orden

1. **Motor CLI** (`aprender`/`clasificar`/`matchear`/`puntear`) — aprende de las líneas ya punteadas históricamente (492 líneas la primera vez).
2. **Webapp**: checklist agrupado por proveedor, subida de factura con matching automático por importe (incluidas combinaciones de 2 facturas), estado "pedida, pendiente de recibir", todo persistido en base de datos (no en el navegador), captura de cámara en móvil, "Cerrar trimestre" genera zip de facturas numeradas + xlsx final.
3. Desplegado y verificado con datos reales: 291 grupos de proveedores (50 fijos, 201 factura propia, 31 nuevos), 310 combinaciones proveedor→nota migradas desde `memoria_proveedores.json`. **Ojo: esto fue verificación técnica/API (que los datos se procesan y guardan bien), no un uso real.** Nadie había probado a *usar* la app de verdad hasta después — fue al intentarlo cuando se vio que era un desastre en general, lo que disparó la auditoría de UX de más abajo.
4. Fix: subir el excel dos veces fusiona en vez de borrar las notas ya confirmadas. Las facturas sueltas se pueden subir antes de que exista el excel del trimestre.
5. Fix: bug de `pdf-parse` roto en el entorno serverless de Vercel (`DOMMatrix is not defined`) — solucionado bajando de v2 a v1.
6. Selector de trimestre (listar / crear / borrar) para poder probar sin ensuciar datos reales.
7. **Colaboradores, lotes y pagos**: la gente del equipo sube facturas de un evento a su propio "lote" (usuario/contraseña, no enlace mágico — se mezclan entre personas). El total gastado se ve en caliente desde la primera factura (control de gasto en curso, no solo al cierre). Cada factura se acepta o rechaza (ticket ≠ factura válida; las rechazadas nunca llegan a la gestoría). El pago se puede repartir en varios "pagos" independientes — un anticipo y su diferencia posterior son dos movimientos de banco distintos, no uno.

## Plan de UX (auditoría, 3 fases)

- **Fase 1 — confianza** ✅ hecho (commit `576d64c`, 2026-07-27): toasts de guardado/error, diálogos propios (`ConfirmDialog`, `MotivoDialog`) en vez de `window.confirm`/`window.prompt`, manejo de errores consistente en las llamadas a la API (`apiFetch`).
- **Fase 2 — pendiente**: buscador/filtro en la lista de proveedores (con ~290 grupos, desplazarse a mano es un suplicio); separar el panel de admin en pestañas (gestión del trimestre vs. colaboradores/lotes) en vez de un único scroll largo.
- **Fase 3 — pendiente**: botones de guardar explícitos en móvil (el guardado solo por `onBlur` falla con el teclado virtual), botón de copiar la contraseña generada de un colaborador, estados vacíos con guía, accesibilidad (el estado no debe depender solo del color), formato consistente de números/fechas.

## Línea visual (decidida 2026-07-27, pendiente de aplicar al código)

- Fondo blanco puro / neutro, sin ningún tinte de color en tarjetas ni bordes.
- Acento único: azul oscuro `#2c4358` (claro) para botón principal, barra de progreso y punto de "pendiente" — nada más lleva color.
- Categorías de proveedor (fija/factura propia/mixta/nueva) como texto simple junto al nombre, no insignias de colores — el "semáforo" de colores por categoría es justo lo que se rechazó.
- Tipografía: familia Calibri (`Calibri, Candara, "Segoe UI", sans-serif`).
- Tamaño de letra notablemente más grande que un UI por defecto — la app se usa muchas horas seguidas: nombres de proveedor ~16.5px, texto secundario ~14.5px, botones/inputs 16px.
- Tema oscuro descartado explícitamente (ya se había descartado antes, en la sesión anterior, por el mismo motivo de fatiga visual en sesiones largas).
- Aún no aplicado a `app/globals.css` ni a los componentes reales — de momento vive solo en mockups (Artifacts).

## Registro de decisiones

Cada decisión de producto/alcance/diseño se anota aquí en cuanto se toma, con fecha.

- **2026-07-27** — Se reconstruyó este documento desde cero leyendo la sesión anterior completa (1598 mensajes), porque no existía como archivo — vivía solo dentro del modo Plan de esa conversación y se perdió el hilo entre sesiones. A partir de ahora se mantiene aquí para que no vuelva a pasar.
- **2026-07-27** — Aclarado que nada de la app está realmente testado en uso real: la "verificación con datos reales" fue solo a nivel técnico/API. El desastre se descubrió al intentar usarla de verdad, no antes. No dar por hecho que ninguna pantalla/flujo funciona bien en la práctica solo porque el código compile o la API responda.
