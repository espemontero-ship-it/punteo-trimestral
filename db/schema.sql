-- Esquema para Postgres (Neon, vía integración de Vercel).
-- Ejecutar una vez contra la base nueva antes de usar la webapp.
-- (Idempotente: usa IF NOT EXISTS / ADD COLUMN IF NOT EXISTS, seguro re-ejecutarlo.)
--
-- Nota (2026-08-02): "trimestre" ya NO es la partición de movimientos/facturas
-- del flujo principal -- viven en un único histórico continuo (ver
-- db/migration_continuo.sql). La tabla `trimestres` se mantiene solo porque
-- el módulo de colaboradores/lotes sigue teniendo trimestre por lote (se
-- rediseña aparte, más adelante).

CREATE TABLE IF NOT EXISTS trimestres (
  id TEXT PRIMARY KEY,               -- ej. '2026-Q3' -- solo lo usan lotes/colaboradores
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  cerrado BOOLEAN NOT NULL DEFAULT false
);

-- Colaboradores del equipo que suben facturas de un evento (usuario/contraseña propios).
CREATE TABLE IF NOT EXISTS colaboradores (
  id BIGSERIAL PRIMARY KEY,
  nombre TEXT NOT NULL,
  usuario TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'activo', -- activo | inactivo
  puede_invitar BOOLEAN NOT NULL DEFAULT false, -- puede invitar a más gente a su mismo proyecto
  puede_subir_facturas_generales BOOLEAN NOT NULL DEFAULT false, -- facturas de NOL, sin proyecto
  rol TEXT NOT NULL DEFAULT 'colaborador', -- colaborador | admin
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Invitaciones (alta sin contraseña dictada a mano) y recuperación de
-- contraseña, ambas por enlace de un solo uso mandado por correo.
CREATE TABLE IF NOT EXISTS tokens_acceso (
  id BIGSERIAL PRIMARY KEY,
  tipo TEXT NOT NULL,                 -- 'invitacion' | 'restablecimiento'
  token_hash TEXT NOT NULL UNIQUE,
  colaborador_id BIGINT REFERENCES colaboradores(id) ON DELETE CASCADE,
  nombre TEXT,
  usuario TEXT,
  proyecto TEXT, -- NULL si es una invitación sin proyecto (solo facturas generales de NOL)
  puede_subir_facturas_generales BOOLEAN NOT NULL DEFAULT false,
  invitado_por BIGINT REFERENCES colaboradores(id),
  expira_en TIMESTAMPTZ NOT NULL,
  usado_en TIMESTAMPTZ,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Un lote = las facturas de un colaborador para un evento concreto, dentro de un trimestre.
CREATE TABLE IF NOT EXISTS lotes (
  id BIGSERIAL PRIMARY KEY,
  trimestre_id TEXT NOT NULL REFERENCES trimestres(id) ON DELETE CASCADE,
  colaborador_id BIGINT NOT NULL REFERENCES colaboradores(id) ON DELETE CASCADE,
  evento TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'abierto', -- abierto | cerrado
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Un envío a gestoría = el paquete real que se manda (ya no es "cerrar un
-- trimestre" -- cubre un rango de fechas, se genera cuando haga falta).
CREATE TABLE IF NOT EXISTS envios_gestoria (
  id BIGSERIAL PRIMARY KEY,
  etiqueta TEXT,
  desde DATE,
  hasta DATE,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS facturas (
  id BIGSERIAL PRIMARY KEY,
  trimestre_id TEXT REFERENCES trimestres(id) ON DELETE CASCADE, -- NULL salvo facturas de lote (colaboradores)
  envio_id BIGINT REFERENCES envios_gestoria(id) ON DELETE SET NULL, -- NULL = todavía sin enviar a gestoría
  proveedor_clave TEXT,               -- null para facturas de lote (colaboradores)
  ruta_blob TEXT NOT NULL,
  nombre_original TEXT,
  numero INT,                         -- número asignado para la entrega final a Drive
  importes NUMERIC(12,2)[] NOT NULL DEFAULT '{}',
  totales NUMERIC(12,2)[] NOT NULL DEFAULT '{}',
  fechas DATE[] NOT NULL DEFAULT '{}',
  es_imagen BOOLEAN NOT NULL DEFAULT false,
  estado TEXT NOT NULL DEFAULT 'sin_match', -- sin_match | matcheada | revisar (solo facturas de proveedor)
  motivo_tipo TEXT,                   -- tipo del ultimo intento de match (sin_importe, ambiguo...)
  motivo_detalle TEXT,                -- detalle legible del ultimo intento de match
  motivo_candidatos JSONB,            -- candidatos de un caso ambiguo/combo_sugerido, para pintar los botones sin recalcular
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Campos de facturas subidas por un colaborador a un lote:
  lote_id BIGINT REFERENCES lotes(id) ON DELETE CASCADE,
  concepto TEXT,
  importe_declarado NUMERIC(12,2),        -- importe que cuenta para los totales del lote
  estado_revision TEXT,                   -- subida | aceptada | rechazada | cerrada | borrada
  motivo_rechazo TEXT,
  fecha_cierre DATE                       -- fecha en la que se marcó 'cerrada' (liquidada, ya no editable)
);

-- Lista fija de proyectos/eventos (ej. "Wield 2"), creada una vez y reutilizada
-- entre trimestres. Un movimiento puede etiquetarse con uno, inferido por texto
-- o asignado a mano.
CREATE TABLE IF NOT EXISTS proyectos (
  id BIGSERIAL PRIMARY KEY,
  nombre TEXT NOT NULL UNIQUE,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cada excel subido es su propia importación (no un singleton por banco) --
-- se puede subir el extracto de un banco muchas veces a lo largo del año sin
-- que cada subida reemplace a la anterior, y se puede borrar una subida
-- suelta sin perder las demás.
CREATE TABLE IF NOT EXISTS importaciones (
  id BIGSERIAL PRIMARY KEY,
  hoja TEXT NOT NULL,                 -- bbva | openbank | paypal
  ruta_blob TEXT NOT NULL,
  nombre_archivo TEXT,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS movimientos (
  id BIGSERIAL PRIMARY KEY,
  hoja TEXT NOT NULL,                 -- bbva | openbank | paypal
  fila INT NOT NULL,                  -- fila original en el excel subido, para el export final
  importacion_id BIGINT REFERENCES importaciones(id) ON DELETE SET NULL, -- de qué archivo subido viene esta fila
  envio_id BIGINT REFERENCES envios_gestoria(id) ON DELETE SET NULL,     -- NULL = todavía sin enviar a gestoría
  fecha DATE,
  concepto TEXT NOT NULL,
  importe NUMERIC(12,2) NOT NULL,
  clave TEXT NOT NULL,                -- clave normalizada (lib/normalize.js)
  estado TEXT NOT NULL DEFAULT 'sin_resolver', -- sin_resolver | resuelta | pedida_pendiente | factura_futura | ignorada
  nota_final TEXT,
  proveedor TEXT,
  proyecto_id BIGINT REFERENCES proyectos(id),
  es_devolucion BOOLEAN NOT NULL DEFAULT false,
  jugador_larpmanager TEXT,           -- solo si es_devolucion
  larpmanager_candidatos JSONB,       -- candidatos del cruce de ingresos con LarpManager
  datos_originales JSONB -- todas las columnas de la fila del excel, {nombre_columna: valor}, para poder mostrarlas/ocultarlas en pantalla sin perder nada
);

CREATE TABLE IF NOT EXISTS movimiento_facturas (
  movimiento_id BIGINT NOT NULL REFERENCES movimientos(id) ON DELETE CASCADE,
  factura_id BIGINT NOT NULL REFERENCES facturas(id) ON DELETE CASCADE,
  PRIMARY KEY (movimiento_id, factura_id)
);

-- Un pago = dinero que se le manda a un colaborador para su lote (anticipo, diferencia,
-- reembolso...). Se van añadiendo tantos como haga falta; cada uno se concilia luego,
-- por separado, contra su línea del banco.
CREATE TABLE IF NOT EXISTS pagos (
  id BIGSERIAL PRIMARY KEY,
  lote_id BIGINT NOT NULL REFERENCES lotes(id) ON DELETE CASCADE,
  importe NUMERIC(12,2) NOT NULL,
  fecha DATE,
  nota TEXT,
  movimiento_id BIGINT REFERENCES movimientos(id),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Asociación opcional: qué facturas concretas justifica un pago concreto.
CREATE TABLE IF NOT EXISTS pago_facturas (
  pago_id BIGINT NOT NULL REFERENCES pagos(id) ON DELETE CASCADE,
  factura_id BIGINT NOT NULL REFERENCES facturas(id) ON DELETE CASCADE,
  PRIMARY KEY (pago_id, factura_id)
);

-- Pagos de LarpManager (CSV exportado, filas Wire + "manual") -- se cruzan
-- contra todo el histórico de ingresos sin resolver, no por trimestre.
CREATE TABLE IF NOT EXISTS larpmanager_pagos (
  id BIGSERIAL PRIMARY KEY,
  nombre_real TEXT NOT NULL,
  evento TEXT,
  importe NUMERIC(12,2) NOT NULL,
  fecha DATE,
  movimiento_id BIGINT REFERENCES movimientos(id) ON DELETE SET NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memoria_proveedores (
  hoja TEXT NOT NULL,
  clave TEXT NOT NULL,
  nota TEXT NOT NULL,
  veces INT NOT NULL DEFAULT 1,
  PRIMARY KEY (hoja, clave, nota)
);

CREATE INDEX IF NOT EXISTS idx_movimientos_proyecto ON movimientos(proyecto_id);
CREATE INDEX IF NOT EXISTS idx_movimientos_clave ON movimientos(clave);
CREATE INDEX IF NOT EXISTS idx_movimientos_importacion ON movimientos(importacion_id);
CREATE INDEX IF NOT EXISTS idx_movimientos_envio ON movimientos(envio_id);
CREATE INDEX IF NOT EXISTS idx_facturas_envio ON facturas(envio_id);
CREATE INDEX IF NOT EXISTS idx_facturas_lote ON facturas(lote_id);
CREATE INDEX IF NOT EXISTS idx_lotes_colaborador ON lotes(colaborador_id);
CREATE INDEX IF NOT EXISTS idx_lotes_trimestre ON lotes(trimestre_id);
CREATE INDEX IF NOT EXISTS idx_pagos_lote ON pagos(lote_id);
CREATE INDEX IF NOT EXISTS idx_tokens_acceso_hash ON tokens_acceso(token_hash);
CREATE UNIQUE INDEX IF NOT EXISTS larpmanager_pagos_natural_key ON larpmanager_pagos(nombre_real, evento, importe, fecha);
