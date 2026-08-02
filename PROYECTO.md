# Punteo trimestral — hoja de proyecto

Este documento es la fuente de verdad del proyecto: qué es, qué decisiones se han tomado y por qué, y qué queda pendiente. Se actualiza cada vez que se toma una decisión de producto, alcance o diseño — no hace falta bucear en sesiones antiguas para reconstruirlo.

## Regla de trabajo (fija, no negociable)

**Se muestra antes de implementar. Se habla antes de implementar.** Esto aplica a cualquier cambio — código real, config, base de datos, y también mockups/maquetas.

"Mostrar" = describir o previsualizar **sin tocar ningún archivo**. "Implementar" = editar el archivo (aunque sea un mockup) y volver a publicarlo. Son dos pasos distintos y no se saltan: si la usuaria pide "muéstramelo", la respuesta es una descripción o boceto en palabras, nunca una edición de archivo — ni siquiera de un mockup. Solo se edita después de una confirmación explícita a esa descripción. Una idea a medio formular, o una petición que "parece clara", no es autorización para tocar un archivo.

**2026-07-27, regla ampliada — "mockup siempre":** para cualquier cambio visual/de layout (no solo funcionalidad nueva), la validación previa tiene que ser un **mockup visual real**, no basta con describirlo en palabras — el comportamiento de CSS (scroll, sticky, anchos) es demasiado fácil de imaginar mal en texto. Construir el mockup, enseñarlo, y solo tras confirmación explícita aplicarlo al código real de la app.

Ver [[feedback-validate-before-coding]] en memoria — esta regla ya se incumplió más de una vez en la sesión del 2026-07-27 y hay que dejar de repetirlo.

**2026-07-28 — subir cambios sin pedir permiso cada vez.** Una vez un cambio está verificado (build limpio, y probado en local cuando es posible), se hace commit y push directamente, sin esperar a que la usuaria escriba "commit y push" cada vez. Motivo explícito: "cuantos menos oks te dé mejor, porque hay veces que no puedo hacerte caso" — minimizar cuántas veces necesita responder, no solo por comodidad. Esto **no** afecta a la regla de arriba (mostrar antes de implementar cambios de diseño/estructura/navegación) — sigue exactamente igual, esa validación es sobre qué se construye, esta es sobre cuándo se publica algo ya construido y verificado.

## Qué es y para quién

Aplicación para una asociación sin ánimo de lucro (carpeta de Drive: "NOT ONLY LARP" — administración). Cada trimestre hay que mandar a la gestoría el punteo del banco contra las facturas de gastos, para que preparen IVA, IRPF e IS.

Proceso manual que sustituye: bajar el excel del banco, subirlo a Drive, buscar cada factura a mano y relacionarla por número (las facturas se numeran para que el nombre del archivo coincida con la nota escrita en el excel, ej. `59 y 60` cuando una línea del banco cubre dos facturas juntas).

## Alcance — decisiones cerradas

- **Ingresos y devoluciones de tickets quedan fuera del emparejamiento inteligente para siempre** (aprender de proveedor, cruzar contra una factura) — no del punteo en sí. **Matización 2026-07-27**: el punteo del banco cubre *todas* las líneas, ingreso o gasto, porque hay que dar cuenta de cada movimiento. Para una línea de ingreso, la "nota" no es un número de factura — es una referencia a su fila en la pestaña de ingresos/anticipos/devoluciones del mismo archivo que se manda a gestoría. El mecanismo ya existe: el campo de nota manual + "Confirmar" que ya tienen los grupos "nueva"/"mixta" sirve igual para esto, sin necesitar nada nuevo.
- **Sin IA/ML.** Todo determinista: regex + heurísticas sobre texto. Si algo falla, se puede ver exactamente por qué.
- **Sin OAuth de Google Drive.** Se lee una carpeta local sincronizada con Google Drive para escritorio — nunca se conecta la cuenta por API.
- **Agrupar por proveedor, no línea a línea.** Decisión explícita: revisar 380 líneas una a una, aunque cada una tenga una sugerencia, sigue siendo 380 decisiones — el ahorro real viene de actuar sobre el grupo entero de una vez.
- **El excel se sube cada vez, no hay ruta fija** — hay tres fuentes (bbva/openbank/paypal) que cambian cada trimestre.
- **Tiene que funcionar desde el móvil con cámara** (foto del recibo en el momento de comprar) — esto es lo que obligó a que fuera una webapp en la nube en vez de un script local.

## Ideas futuras (a pensar más adelante, no construir todavía)

- **Punteo de ingresos — hecho en parte (2026-08-01).** El cruce contra LarpManager (botón "Subir LarpManager", emparejamiento por nombre contra el CSV de pagos Wire) ya está construido — ver "Funcionalidades construidas". Quedan fuera de esta primera versión: enlace/escritura de vuelta a LarpManager, y buscar contra inscripciones pendientes sin confirmar en LarpManager. **Las devoluciones ya se construyeron por separado, ver más abajo.**
- ✅ **Devoluciones a jugadores — construido y verificado (2026-08-02).** Cuando un jugador se da de baja de un evento y se le devuelve parte de lo pagado (por PayPal o transferencia), esa línea saliente del banco se puede marcar como devolución en vez de como gasto de proveedor — mutuamente excluyente con Proveedor (`marcarDevolucion` en `lib/devoluciones.cjs`, quita el proveedor si lo hubiera y resuelve la línea directamente, sin desplegable de Estado intermedio). Diseño acordado explícitamente con la usuaria antes de construir (no hay export de bajas/cancelaciones en LarpManager con el que cruzar automáticamente, así que el nombre del jugador se escribe a mano, aunque se sugiere a partir del propio texto del banco):
  - **Detectar**: si el concepto contiene "devolución"/"refund"/"reembolso", el enlace "¿Es una devolución?" se resalta (`chip-sugerencia`) — nunca se marca sola, solo destaca el enlace. Sin esa palabra, el enlace sigue ahí pero sin resaltar (marcar a mano sigue siendo posible siempre, la palabra clave no es un requisito, solo una ayuda).
  - **Sugerir jugador**: se extrae del propio concepto ("TRANSFERENCIA A FAVOR DE X", "TRANSFERENCIAS X" de BBVA, o el nombre que ya encabeza el concepto de PayPal) — siempre editable antes de confirmar.
  - **Proyecto**: se reutiliza el desplegable de Proyecto que ya existía en la tabla, sin duplicar el campo.
  - **Por trimestre** (para el IVA): botón "Ver devoluciones" en la pestaña Trimestre + pestaña nueva "Devoluciones" en el excel final de "Cerrar trimestre" (Fecha/Importe/Proyecto/Jugador/Nota), solo si hay alguna ese trimestre.
  - **Por proyecto, cruzando trimestres** (para el cierre en IS): botón "Ver devoluciones" junto a cada proyecto en `/proyectos`, con descarga a CSV — un proyecto no vive dentro de un solo trimestre, así que esta vista consulta todos.
  - Verificado en local insertando un movimiento de prueba con "devolución" en el concepto: sugerencia de jugador correcta, confirmación pasa la línea a resuelta y quita el enlace de "sacar del grupo"/Proveedor normal, aparece en el modal del trimestre, en la pestaña del excel final (simulado, ya que Blob no funciona en local) y en el listado del proyecto tras asignarlo.
- **Ver todo el año, no solo un trimestre — pendiente de hablar (2026-08-01).** La usuaria comentó de pasada que subir el excel del banco es acumulativo, y que le gustaría poder ver toda la información del año e ir cerrando trimestres cuando ella decida, no necesariamente en bloques rígidos de trimestre natural. Toca bastante de cómo funciona la app hoy (cada trimestre como unidad separada con su propia base de datos/`trimestreId`, qué significa "cerrar"). Explícitamente aparcado para hablarlo aparte, con calma, antes de tocar nada — no es una petición de cambio todavía, solo una idea a validar primero.

## Cómo funciona

No adivina proveedores por su cuenta: aprende de las notas ya escritas en trimestres anteriores. Agrupa por proveedor (no línea a línea). Al subir una factura, la cruza automáticamente contra las líneas pendientes de ese proveedor, incluida la detección de que dos facturas juntas sumen el importe de una línea.

El flujo real, tal como lo especificó la usuaria el 2026-07-27 (corrigiendo una lectura anterior errónea que mezclaba esto con "leer una carpeta de Drive"), tiene tres bloques separados. Importante para usabilidad — cada punto es un requisito propio, no una idea general:

### Antes de cerrar el trimestre

- Me ayudaría poder subir facturas sueltas o en grupo, para tenerlas listas para cuando vayamos a cerrar el trimestre.

### Cuando voy a cerrar el trimestre

- Subo excels para conciliación.
- Agrupamos por proveedor, para que tarde menos en la búsqueda.
- No subo de una en una — el fin es poder guardar todas las de un proveedor (ej. todas las de Amazon) y subirlas todas de golpe, y que el sistema haga el match.
- Necesito ver los proveedores que queden pendientes de buscar factura.
- Algunos proveedores me mandan la factura más tarde y se marcan pendientes. **Resuelto** (ver más abajo): atajo opcional "es una de las pendientes" al subirla.
- Cierro en determinado momento y mando la info a gestoría — necesito tener guardada en mi Drive toda la info.

### Gestión de proyectos concretos (va aparte de lo anterior)

- Crear colaborador.
- Que suba facturas.
- Aprobar facturas y hacer pagos y adelantos.

*(Esto último es la funcionalidad de colaboradores/lotes/pagos ya construida — confirmado que es una pista independiente del flujo de conciliación trimestral, no parte de él.)*

**Facturas que llegan tarde** — decisión tomada el 2026-07-27: al subir esa factura más tarde, hay un atajo **opcional** para decir "esto es una de mis pendientes" y elegirla de la propia lista de pedidas-esperando — match directo, sin depender de que el importe adivine bien. Es opcional y no el camino por defecto porque estos casos son raros (2-10 por trimestre) frente al volumen normal (200-500 líneas/trimestre) — forzar el paso extra siempre sería más fricción de la que ahorra.

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

## Huecos identificados (2026-07-27, pendientes de construir)

- ✅ **Hecho — Subida en lote de facturas.** [SubirFacturasLote.js](app/components/SubirFacturasLote.js) (input `multiple`, procesa y empareja varias a la vez), ya en uso en la pestaña Trimestre. Esta nota se quedó desactualizada — comprobado 2026-08-01 que ya está construido, no es un hueco.
- **Atajo "es una de las pendientes"** al subir una factura que llegó tarde (ver flujo arriba) — diseño acordado, sin construir todavía.
- ✅ **Hecho (2026-07-27) — Información por línea en el checklist, como tabla real de columnas.** Cabecera del grupo: importe total del grupo, a la derecha. Al expandir: **tabla** de verdad (`<table>`, no tarjetas apiladas) con columnas Fecha / Concepto / Proveedor / Importe / Nota — una fila por movimiento (resuelto o no; antes los resueltos desaparecían del todo). Si ya tiene nota, se ve ahí mismo; si hay factura emparejada, enlace directo "Ver factura →". Backend: `lib/agrupador.cjs` también devuelve `factura_ids` por movimiento (join con `movimiento_facturas`). Verificado insertando datos de prueba en la base de datos local y comprobando en el navegador.
- ✅ **Hecho (2026-07-27) — Columna Proyecto.** Lista fija de proyectos (ej. "Wield 2"), creada una vez y reutilizada entre trimestres — **no está ligada a un trimestre ni a un año**, vive en su propio apartado `/proyectos`, enlazado desde el menú general (pantalla de selector de trimestre), no dentro de ningún trimestre. Al puntear una línea, si el concepto contiene el nombre de un proyecto ya creado se sugiere solo (botón "¿Wield 2?"), sin asignarlo hasta que se confirma — nunca decide sola. Estados de proyecto (activo/cerrado) quedan aparcados para cuando haga falta, no se construyen todavía. Tabla nueva `proyectos` + columna `movimientos.proyecto_id`, migración aplicada contra la base de datos real (`db/migration_proyectos.sql`). Verificado end-to-end en el navegador: crear proyecto, ver la sugerencia por texto, confirmarla, comprobar que queda guardada.
- Sobre el CLI (`aprender`/`clasificar`/`matchear`/`puntear`): **no se archiva ni se borra sin más.** La lógica de fondo (`lib/normalize.js`, `lib/clasificarCore.js`, `lib/facturas.js`, `lib/matchearCore.js`) ya es compartida con el webapp, así que no se pierde nada ahí. Lo único específico del CLI es que `matchear.cjs` procesa una carpeta entera de golpe — que es exactamente la misma necesidad que "subida en lote" de arriba, solo que resuelta del lado del CLI en vez del navegador. Construir la subida en lote en el webapp es lo que de verdad haría al CLI prescindible; hasta entonces, tocarlo sería quitar una capacidad real sin sustituto.

## Bugs conocidos

- ✅ **Arreglado (2026-07-27) — Config de columnas de bbva desactualizada.** `config/sheets.json` tenía `importeCol: "H"` para bbva, pero el export real actual de bbva tiene `H` = **Saldo de la cuenta** (no el importe); el importe real está en `G`. Consecuencia doble: el importe se guardaba mal (saldo en vez de importe real), y como `textCols` incluía `G`, el número del importe se pegaba al texto del concepto (ej. "TRANSFERENCIAS ALVARO MAESTRO -51 64") — por eso la agrupación no consolidaba nada, cada fila tenía su propia "clave" única. Dos síntomas que parecían bugs de UI (agrupación rota, "faltan movimientos") eran el mismo bug de columnas. Corregido a `dataStartRow: 2, textCols: ["E","F"], importeCol: "G"` (columnas reales confirmadas con un excel real: `A` nº, `B` fecha contable, `C` fecha valor, `D` código, `E` concepto, `F` observaciones, `G` importe, `H` saldo, `I` divisa, `J` oficina — formato de export de bbva más nuevo que el usado al configurar `sheets.json` originalmente). Verificado simulando el parseo contra el excel real: 55 de 55 filas, importes limpios, "LIQUIDACION REMESA DE COMERCIOS" pasa de 17 tarjetas sueltas a 1 con 17 movimientos.
- ⚠️ **Dato importante:** los movimientos que ya existen en la base de datos de trimestres de prueba (ej. "test 2") se importaron con la config vieja y están corruptos (importe = saldo, texto con el importe pegado). Volver a subir el mismo excel a ese trimestre **no los corrige** — el import fusiona por fecha+importe+texto, y como esos valores cambian con el fix, se crearían filas duplicadas en vez de reemplazar las malas. Para probar limpio: borrar el trimestre de prueba y crear uno nuevo antes de volver a subir.
- ⚠️ **El formato de columnas de bbva no está cerrado todavía.** Existen (al menos) dos formatos reales distintos: el `2026.xlsx` que se entrega a gestoría (con columna extra "Beneficiario/Ordenante", importe en `H`, 2 filas de cabecera) y un export más nuevo sin esa columna (importe en `G`, 1 fila de cabecera) que se usó para el fix del 2026-07-27. La usuaria confirma que están todavía haciendo pruebas y que **el formato definitivo será otro distinto a estos dos** — la config actual de `sheets.json` vale para las pruebas de ahora, pero hay que revisarla otra vez en cuanto exista el formato final. No construir detección automática de formato hasta entonces, sería prematuro.
- **Confirmado: el export final a gestoría no depende de lo guardado en la base de datos.** `lib/exportar.cjs` reconstruye el `.xlsx` final descargando el excel original tal cual se subió (con todas sus columnas) y solo escribe la nota encima — así que ninguna columna se pierde nunca en la entrega final, pase lo que pase con la config de import. Lo que sí falta es mostrar en pantalla lo que ya se guarda (`concepto`, `importe`, `nota_final` — ya en la tabla `movimientos`, sin necesidad de guardar nada nuevo): es el mismo hueco #2 de arriba ("falta información en cada línea"), no un problema de almacenamiento.
- **Limitación de entorno (no es un bug): subir un excel no funciona en `localhost`.** Vercel Blob usa autenticación OIDC que solo está activada para los entornos Production/Preview, no para "development" — cualquier intento de subir un excel en local falla con `Vercel Blob: OIDC is enabled for this project, but not for the "development" environment`. Para verificar cambios que dependan de subir un excel, hay que probarlos en producción o insertar datos de prueba directamente en la base de datos (como se hizo para verificar el punto de arriba).
- ✅ **Arreglado (2026-08-02) — Candidatos de match ambiguo/combo no se guardaban en BD.** Cuando el matching automático (subida de excel del banco, "Recalcular facturas sin resolver") encontraba varias líneas con el mismo importe (`ambiguo`) o una combinación de 2 facturas (`combo_sugerido`), solo se guardaba el texto del motivo (`motivo_detalle`) — la lista real de candidatos vivía solo en memoria y se perdía al terminar la llamada. La pantalla de Facturas solo pintaba los botones para elegir candidato si se acababa de recalcular esa fila concreta a mano ("Buscar"), aunque el cruce ya estuviera hecho — mismo problema de estado efímero vs. persistido que [LarpManager](#) tuvo antes. Reportado por la usuaria como "he subido un banco y hay muchas facturas que se pueden matchear que no están matcheadas". Arreglado guardando los candidatos en una columna nueva `facturas.motivo_candidatos` (JSONB, migración perezosa igual que `motivo_tipo`/`motivo_detalle`) y haciendo que `FacturasTrimestre.js` los lea de ahí cuando no hay un resultado más reciente en la sesión. Verificado insertando una factura de prueba con importe ambiguo en la base de datos de prueba: tras `reintentarPendientes`, los candidatos quedan en BD y la fila los pinta correctamente sin tocar "Buscar", en una carga de página nueva.

## Backlog de pruebas y pulido (2026-07-28, pendiente de revisar)

La usuaria va a hacer varias pruebas con datos reales; según lo que salga, hay que volver sobre esto:

- [ ] **Check match** — revisar que el emparejamiento automático de facturas funciona bien con datos reales.
- [ ] **Afinar proceso de cierre de trimestre.**
- [ ] **Documentación a gestoría** — revisar qué se entrega y cómo.
- [ ] **Módulo de colaboradores** — afinar.
- [ ] **Facturas futuras** (2026-08-02) — proveedores tipo DoYouSpain e Iberia, y en general archivos que traen **dos facturas dentro del mismo PDF** (el parseo actual asume una factura por archivo).
- [x] **Match entre pago y LarpManager.** Construido y probado con datos reales 2026-08-01/02 — varias rondas de fallos reales encontrados y arreglados: persistencia del botón de confirmar (antes se perdía al recargar), diéresis alemanas, apellido en vez de nombre completo, pagos "manual" sin Wire, y confirmado que un export de LarpManager con rango de fechas corto simplemente no trae ciertos pagos (no es un bug). El caso "varios candidatos con el mismo importe" se sigue sin verificar con una colisión real todavía.
- ✅ **Arreglado (2026-08-02) — Solucionar PayPal.** Probado con un export real (`Download (3).xlsx`, cuenta business de PayPal): la config antigua por letra fija (`textCols`, `importeCol: "I"`, `fechaCol: "B"`) apuntaba a las columnas equivocadas (fecha en B era en realidad "Hora"; importe en I era "Tarifa", no "Neto") — mismo tipo de problema que tuvo BBVA. Migrado a `"modo": "nombres"` como bbva/openbank: fecha = columna "Fecha", importe = columna "Neto" (el que de verdad afecta al saldo, no el bruto), texto = "Nombre" + "Tipo" + "Asunto" + "Nota" (esta última a veces tiene anotaciones manuales reales, ej. "refund Inconscience"). Verificado simulando el parseo contra el excel real: fecha/importe/texto correctos en las 5 filas, notaCol cae en la columna 42, confirmada vacía.
  - **Bug adicional encontrado con la misma prueba, ya arreglado:** un export "suelto" de un solo banco conserva el nombre de hoja que le puso el banco (ej. "Download (3)" en este PayPal real), no el nombre canónico ("paypal"). Al cerrar el trimestre, si esa era la única hoja subida, `generarExcelFinal` usaba el workbook original sin renombrar la hoja — el paso que escribe las notas la busca por nombre y no la encontraba, así que esa hoja se entregaba a gestoría **sin ninguna nota, en silencio**. Arreglado en `lib/exportar.cjs`: si solo hay una hoja subida y su nombre no coincide, se renombra antes de generar el excel final. No afecta al export combinado (varias pestañas en un mismo archivo), donde cada pestaña ya se llama como debe.

## Arquitectura de información — 3 pestañas por momento de uso (acordado 2026-07-27)

El problema de fondo detectado en la auditoría completa (más abajo) no era una lista de bugs sueltos: era que **una sola pantalla mezclaba todos los momentos de uso**, sin importar por qué se abría la app. Se decidió dividir la vista de un trimestre en 3 pestañas, cada una pensada para un momento concreto (mockup en Artifact, verificado con la usuaria antes de escribir código):

- **Inicio** — el momento de "voy a subir una foto rápida y ya". Lo primero y más grande que se ve es "Subir factura suelta". Debajo, un resumen mínimo (X de Y resueltas) con un enlace a "ver pendientes". Nada de excel, nada de checklist, nada de colaboradores.
- **Trimestre** (nombrada así, no "Proveedores") — la sesión de cierre: subida en lote destacada arriba, buscador + toggle "solo pendientes", el excel colapsado en un desplegable (no se toca cada vez que se entra), el checklist agrupado, y "Cerrar trimestre" al final — es parte de esta sesión, no una acción de un vistazo.
- **Colaboradores** — su propio espacio, ya no comparte scroll ni interrumpe las otras dos.

Esto sustituye y concreta el ítem suelto que había en la Fase 2 de la auditoría anterior ("separar en pestañas"). Línea visual de la reorganización: pendiente ("ya veríamos, vamos poco a poco" — la estructura se acordó antes que el acabado visual final).

## Auditoría de UX completa (2026-07-27)

Revisión de las 20 pantallas/componentes reales contra el flujo de arriba. Los ítems de arquitectura (🔴 1-3) ya se resolvieron con la reorganización en pestañas; el resto sigue pendiente de construir.

**Antes de cerrar / Trimestre** (`page.js`, `GrupoProveedor.js`, `SubirFactura.js`)
- 🔴 Sin subida en lote — ver "Huecos identificados".
- 🔴 Sin buscador/filtro de proveedores — con 290 grupos, encontrar uno es scroll a ciegas.
- 🔴 Sin vista "solo lo pendiente" — resueltos y no resueltos se listan mezclados.
- 🟠 Nada distingue visualmente los grupos "un clic y resuelto" (fija) de los que dan trabajo, salvo texto pequeño.
- 🟠 El estado "pedida, pendiente" no tiene vista propia — no hay un sitio único para ver todo lo que se está esperando de proveedores.
- 🟠 Confirmar un grupo entero no tiene deshacer.
- 🟡 El selector de excel no confirma qué detectó hasta después de subirlo.

**Colaboradores y lotes** (`SeccionLotes.js`, `SubirFacturaLote.js`, `lotes/[id]/page.js`, `colaborador/page.js`)
- 🔴 `SubirFacturaLote` tampoco admite varios archivos — y aquí pesa más, porque es la propia colaboradora quien repite la subida una a una por cada recibo de un evento.
- 🟠 La contraseña de colaborador se enseña una vez sin botón de copiar, y no se puede regenerar sin borrar el colaborador entero.
- 🟠 "Ver archivo" de una factura abre en pestaña aparte — se revisa importe/concepto sin ver la imagen a la vez.
- 🟠 Vincular un pago a una línea del banco es un `<select>` con todos los movimientos del trimestre sin filtrar.

**Transversal**
- 🟠 Un único formulario de login sirve para admin y colaboradora (usuario en blanco = admin) — fácil de equivocarse.
- 🟡 "Volver" desde un lote siempre lleva a "/", sin recordar desde qué trimestre se entró.
- 🟡 Formato de número inconsistente entre pantallas.

## Plan de UX (auditoría, 3 fases)

- **Fase 1 — confianza** ✅ hecho (commit `576d64c`, 2026-07-27): toasts de guardado/error, diálogos propios (`ConfirmDialog`, `MotivoDialog`) en vez de `window.confirm`/`window.prompt`, manejo de errores consistente en las llamadas a la API (`apiFetch`).
- **Fase 2 — en curso**: arquitectura en 3 pestañas ✅ acordada (ver arriba); dentro de "Trimestre" siguen pendientes el buscador/filtro, el toggle "solo pendientes" y la subida en lote.
- **Fase 3 — pendiente**: botones de guardar explícitos en móvil (el guardado solo por `onBlur` falla con el teclado virtual), botón de copiar la contraseña generada de un colaborador (+ forma de regenerarla), estados vacíos con guía, accesibilidad (el estado no debe depender solo del color), formato consistente de números/fechas, "ver archivo" de factura junto a los campos en vez de en pestaña aparte, buscador en el `<select>` de vincular pago.

## Línea visual (decidida 2026-07-27, aplicada al código el mismo día)

- Fondo blanco puro / neutro, sin ningún tinte de color en tarjetas ni bordes.
- Acento único: azul de la identidad de NOT ONLY LARP, `#1d5da6` (antes un azul `#2c4358` inventado) — para botón principal, barra de progreso y punto de "pendiente". Texto y gris neutro también alineados con la marca: texto `#231f20`, gris `#58595b` (estimados a ojo del logo en PDF, no hay hex exactos documentados — corregir si aparecen). Decisión 2026-07-27: mantener Calibri (no la Montserrat Extrabold del logo), pero sí adoptar la paleta de color de la asociación.
- Categorías de proveedor (fija/factura propia/mixta/nueva) como texto simple junto al nombre (`.categoria-texto`), no insignias de colores — el "semáforo" de colores por categoría es justo lo que se rechazó.
- Los `.etiqueta.fija/.mixta/.nueva/.pedida` que quedan (estado real aceptada/rechazada/pendiente en lotes y colaboradores) se mantienen coloreados a propósito — es estado semántico, no decoración — pero con tonos apagados (`--ok`/`--warn`/`--new` desaturados) en vez de verde/naranja/rojo saturados.
- Tipografía: familia Calibri (`Calibri, Candara, "Segoe UI", system-ui, sans-serif`).
- Tema oscuro descartado explícitamente (ya se había descartado antes, en la sesión anterior, por el mismo motivo de fatiga visual en sesiones largas) — no hay `prefers-color-scheme` ni variante oscura, un único tema.
- **Aplicado** en `app/globals.css` (tokens, tipografía, `.etiqueta`, toasts, diálogos). Verificado en `localhost:3000` contra un trimestre de prueba real: fondo blanco, botón `rgb(44,67,88)`, fuente Calibri confirmados por JS en el navegador.
- **Pendiente**: no se ha vuelto a subir el tamaño de letra al nivel de los mockups v3 (16.5px nombres / 16px botones-inputs) — los botones/inputs de la app ya estaban en 16px de base, pero no se revisó el resto letra por letra contra el mockup. Revisar si hace falta subir más.

## Tabla plana de la pestaña Trimestre (2026-07-27, reemplaza el acordeón por proveedor)

`GrupoProveedor.js` (acordeón: había que abrir cada tarjeta de proveedor para ver algo) se sustituyó por `app/components/TablaMovimientos.js`, una tabla continua real — motivado directamente porque con ~50-300 grupos, la mayoría de 1 sola línea, "un clic por grupo" era en la práctica "un clic por línea" (~300 clics para ver todo).

**Estructura (versión final, implementada 2026-07-27 sobre `propuesta_completa.html`):**
- Sin acordeón: todos los movimientos visibles de entrada. Grupos de proveedor **solo se muestran con cabecera gris cuando tienen más de 1 movimiento** — un grupo de una sola línea es simplemente una fila más, sin cabecera (ya se había acordado, se coló una vez en un mockup intermedio y se corrigió). La cabecera muestra nombre, categoría, X de Y resueltas y el **importe total real del grupo completo**, no del filtrado por "solo pendientes".
- **Columnas base, en este orden**: Fecha, Concepto, Proveedor, Importe, Estado, Ver factura, Nota, Proyecto. ~~7 columnas, sin columna Factura separada (decisión 2026-07-27: Factura pasa a ser parte de Estado)~~ — **decisión revertida (2026-08-02):** la usuaria la quiere como columna propia, no metida dentro de Estado. "Ver factura" es ahora su propia columna (`app/components/TablaMovimientos.js`), togglable como el resto de columnas base.
- **Fecha y Concepto quedan fijas (`position: sticky`)** al hacer scroll horizontal — es la pestaña de escritorio ancho (`.contenedor-ancho`, 1400px en vez de 720px, solo aplicado a la pestaña Trimestre) y con columnas extra activas el scroll horizontal es habitual; sin esto se pierde de vista a qué línea corresponde cada celda.
- **Estado — desplegable siempre editable, con las 3 opciones (pendiente/pedida/resuelta)**, incluso cuando ya está resuelta: se puede revertir a mano una línea resuelta por error. El enlace "ver factura" ya no vive aquí (ver columna propia arriba).
- **Columnas extra ocultables**: botón "Columnas" abre un panel con casillas — la lista sale dinámicamente de las claves presentes en `datos_originales` de los movimientos cargados. Ocultas por defecto, se pueden activar (ej. "Saldo") y aparecen como columna más al final de la tabla.
- **Buscador general**: filtra por texto en cualquier campo visible, incluidas las columnas extra activas.
- **Ordenar por columna**: clic en cualquier cabecera ordena por ese campo (asc → desc → vuelve a agrupado). Al ordenar se pierde el agrupado visual.
- **Nota**: un único `<input>`, guarda con Enter, sin botón visible. Se prellena en azul con la sugerencia aprendida cuando existe.
- **Acciones de grupo — dos mecanismos separados, explícitamente no fusionados** (decisión 2026-07-27, tras dos rondas de corrección: primero se propuso un sistema de checkboxes/multi-selección que la usuaria rechazó porque no era el patrón ya usado en el resto de la tabla; después se fusionó "aceptar sugerencia" con "aplicar algo distinto" en un único control, y también se rechazó — "no tiene sentido que solo me dejes hacer la acción que sugieres tú"):
  1. Si hay una sugerencia aprendida para el grupo, un chip de un clic: *"¿Aplicar 'X' a las N sin resolver?"*.
  2. Aparte, siempre disponible, el mismo patrón Nota+Estado que ya existe por línea pero a escala de grupo: un campo de nota vacío + un desplegable de estado (pedida/resuelta), para cuando lo que hace falta no es la sugerencia sino algo distinto o cambiar el estado de todo el grupo de golpe.
  Solo se muestran si el grupo tiene líneas sin resolver y no es categoría "factura propia" (ahí no hay nada que sugerir en bloque).
- **Proyecto**: igual que ya estaba (desplegable + sugerencia de un clic "¿Wield 2?").

**Base de datos**: `movimientos.datos_originales JSONB` guarda todas las columnas del excel original tal cual (migración `db/migration_datos_originales.sql`, ya aplicada). `lib/importarExcel.cjs` lee la fila de cabecera para los nombres de columna de cada banco.

**Endpoint** `POST /api/movimientos/:id/estado` (`{ estado: 'pendiente'|'pedida' }`) — cambia el estado individual de una línea vía `lib/agrupador.cjs#marcarLineaEstado` (antes `marcarLineaPendiente`; renombrado porque ahora es un desplegable de 3 estados, no un booleano, y a propósito no exige que la línea no estuviera ya resuelta, para poder revertir).

**Verificación final (2026-07-27)**: datos de prueba reales insertados directamente en la base de datos (`test-final`, limpiado después), probado en el navegador vía DOM/fetch (la herramienta de navegador visual fallaba con "0x0 viewport" esa sesión). Confirmado: cabecera de 7 columnas sin Factura aparte; grupo de 1 línea sin cabecera; grupo de 3 líneas con cabecera y total correcto (186.82€ sumando la línea ya resuelta, no solo las visibles con "solo pendientes" activo); columnas Fecha/Concepto con `position: sticky` y `left` correctos; panel "Columnas" activando "Saldo" en la tabla real; Estado revertido de resuelta → pendiente, persistido en base de datos.

## Registro de decisiones

Cada decisión de producto/alcance/diseño se anota aquí en cuanto se toma, con fecha.

- **2026-07-27** — Se reconstruyó este documento desde cero leyendo la sesión anterior completa (1598 mensajes), porque no existía como archivo — vivía solo dentro del modo Plan de esa conversación y se perdió el hilo entre sesiones. A partir de ahora se mantiene aquí para que no vuelva a pasar.
- **2026-07-27** — Aclarado que nada de la app está realmente testado en uso real: la "verificación con datos reales" fue solo a nivel técnico/API. El desastre se descubrió al intentar usarla de verdad, no antes. No dar por hecho que ninguna pantalla/flujo funciona bien en la práctica solo porque el código compile o la API responda.
- **2026-07-27** — Aplicada la línea visual acordada al código real (`globals.css` + `GrupoProveedor.js`), verificado en el navegador contra datos reales de prueba. Los badges de estado real (aceptada/rechazada/pendiente en lotes/colaboradores) se mantuvieron coloreados pero apagados — solo se quitó el color de las categorías de proveedor, que era decorativo, no de estado.
- **2026-07-27** — Corregido un error de concepto propio: la funcionalidad fundamental que faltaba no era "leer una carpeta de Drive desde el CLI", era la subida en lote de varias facturas a la vez desde el propio webapp (ver "Huecos identificados"). Se decide no tocar el CLI hasta que esto esté construido, porque hoy es lo único que cubre esa necesidad.
- **2026-07-27** — Acordado el flujo de facturas que llegan tarde: atajo opcional "es una de las pendientes" al subir, sin forzarlo como paso obligatorio (2-10 casos/trimestre vs. 200-500 líneas totales).
- **2026-07-27** — Auditoría de UX completa de las 20 pantallas/componentes, hecha contra el flujo real (no una checklist genérica). El hallazgo principal no era una lista de bugs sueltos: una sola pantalla mezclaba los tres momentos de uso sin distinguirlos.
- **2026-07-27** — Acordada la reorganización en 3 pestañas dentro del trimestre: Inicio / Trimestre / Colaboradores (ver "Arquitectura de información"). La pestaña de proveedores se llama "Trimestre", no "Proveedores". Estructura acordada primero; el acabado visual de esta reorganización queda para después ("vamos poco a poco").
- **2026-07-27** — Adoptada la paleta de color real de NOT ONLY LARP (azul `#1d5da6`, texto `#231f20`, gris `#58595b`) en vez del azul inventado en los mockups, a partir del logo/brand kit en PDF que pasó la usuaria. Se mantiene Calibri, no Montserrat. Colores estimados a ojo (sin hex documentado), verificado en el navegador contra el trimestre real.
- **2026-07-27** — Corregido el formato de columnas de la tabla de movimientos: de dos líneas por fila a una tabla real (`<table>`) con Fecha/Concepto/Proveedor/Importe/Nota — la usuaria lo pidió explícitamente como "tabla", no como tarjetas con texto corrido.
- **2026-07-27** — Feedback de proceso de la usuaria, importante para todo el proyecto en adelante: **el flujo de trabajo es idea → validar en palabras → implementar, en ese orden.** No escribir código a partir de una idea a medio formular sin confirmarla antes explícitamente, aunque parezca clara. Motivo: la usuaria corrigió dos veces seguidas en esta sesión ("y proyecto", "y proveedor") mientras ya se estaba implementando código sin haber confirmado el alcance completo primero.
- **2026-07-27** — Añadida la columna/funcionalidad "Proyecto": lista fija (no ligada a trimestre ni, de momento, a año — eso se aparca para cuando haga falta poner estados activo/cerrado), gestionada en su propio apartado `/proyectos` enlazado desde el menú general — explícitamente **no** dentro de la pestaña Trimestre (se preguntó y se corrigió esa colocación antes de terminar). Inferencia por coincidencia de texto contra los proyectos ya creados, nunca auto-asigna sin confirmar.
- **2026-07-27** — Regla de trabajo elevada de una entrada del registro a sección propia al principio del documento ("Regla de trabajo (fija, no negociable)"), porque se volvió a incumplir (se editó un mockup con `sed` justo después de que la usuaria pidiera "muéstramelo"). Aclarado explícitamente: "mostrar" = describir sin tocar archivos; "implementar" = editar y publicar. Son pasos separados, incluso para mockups desechables.
- **2026-07-27** — El campo `movimientos.concepto` ya guardado (usado para agrupar/matchear) es en realidad varias columnas del excel original ya fusionadas en un solo texto (`config/sheets.json`) — no había forma de ver esas columnas por separado en pantalla. Se decide guardar la fila completa aparte, sin tocar cómo se calcula `concepto` (ver sección "Tabla plana" arriba) — la usuaria confirma que los formatos de columnas pueden cambiar por banco en el futuro, pero decide no diseñar para eso todavía ("ya cruzaremos ese puente").
- **2026-07-27** — Rediseñada la pestaña Trimestre entera: de acordeón por proveedor (un clic por grupo para ver nada) a tabla plana continua, con columnas mostrables/ocultables, buscador general y orden por columna. Ver sección "Tabla plana de la pestaña Trimestre" arriba para el detalle completo — fue la sesión de iteración más larga del día, con varias rondas de "quita botones" hasta llegar a: Nota sin botón (Enter guarda), Estado como desplegable (no icono de acción), Sugerencia de grupo como texto (no botón), Sugerencia por línea prellenando el campo (no botón de aceptar separado).
- **2026-07-27** — Ronda final de diseño de la tabla (sobre `propuesta_completa.html`, mockup confirmado antes de tocar código real): (1) se quitó el verde de "resuelta" sin validar — nadie lo había aprobado para esta tabla — sustituido por gris neutro (sin factura) o el azul de acento ya usado en enlaces (con factura), sin introducir color nuevo; (2) Factura deja de ser columna propia y pasa a ser parte de Estado: un enlace "ver factura" bajo el desplegable cuando lo hay; (3) Estado pasa a ser un desplegable de 3 opciones siempre editable, incluida la reversión manual de una línea ya resuelta; (4) las acciones de grupo se mantienen como **dos mecanismos separados** (chip de sugerencia de un clic + Nota/Estado de grupo libres) tras dos rechazos explícitos de alternativas (checkboxes/multi-selección, y fusionar ambos en un único control) — la usuaria necesita poder actuar distinto a la sugerencia, no solo aceptarla o nada; (5) Fecha/Concepto fijas con scroll horizontal y contenedor ancho (1400px) solo en esta pestaña, por ser de uso de escritorio. Implementado en `TablaMovimientos.js`, `lib/agrupador.cjs`, `app/api/movimientos/[id]/estado/route.js` y `globals.css`; verificado en el navegador contra datos de prueba reales (ver detalle en la sección de arriba) antes de limpiar el trimestre de prueba.
