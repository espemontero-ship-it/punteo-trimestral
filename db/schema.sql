-- Esquema para Postgres (Neon, vía integración de Vercel).
-- Ejecutar una vez contra la base nueva antes de usar la webapp.
-- (Idempotente: usa IF NOT EXISTS / ADD COLUMN IF NOT EXISTS, seguro re-ejecutarlo.)

CREATE TABLE IF NOT EXISTS trimestres (
  id TEXT PRIMARY KEY,               -- ej. '2026-Q3'
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  cerrado BOOLEAN NOT NULL DEFAULT false
);

-- Colaboradores del equipo que suben facturas de un evento (usuario/contraseña propios).
CREATE TABLE IF NOT EXISTS colaboradores (
  id BIGSERIAL PRIMARY KEY,
  nombre TEXT NOT NULL,
  usuario TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
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

CREATE TABLE IF NOT EXISTS facturas (
  id BIGSERIAL PRIMARY KEY,
  trimestre_id TEXT NOT NULL REFERENCES trimestres(id) ON DELETE CASCADE,
  proveedor_clave TEXT,               -- null para facturas de lote (colaboradores)
  ruta_blob TEXT NOT NULL,
  nombre_original TEXT,
  numero INT,                         -- número asignado para la entrega final a Drive
  importes NUMERIC(12,2)[] NOT NULL DEFAULT '{}',
  totales NUMERIC(12,2)[] NOT NULL DEFAULT '{}',
  fechas DATE[] NOT NULL DEFAULT '{}',
  es_imagen BOOLEAN NOT NULL DEFAULT false,
  estado TEXT NOT NULL DEFAULT 'sin_match', -- sin_match | matcheada | revisar (solo facturas de proveedor)
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Campos de facturas subidas por un colaborador a un lote:
  lote_id BIGINT REFERENCES lotes(id) ON DELETE CASCADE,
  concepto TEXT,
  importe_declarado NUMERIC(12,2),        -- importe que cuenta para los totales del lote
  estado_revision TEXT,                   -- subida | aceptada | rechazada
  motivo_rechazo TEXT
);

-- Lista fija de proyectos/eventos (ej. "Wield 2"), creada una vez y reutilizada
-- entre trimestres. Un movimiento puede etiquetarse con uno, inferido por texto
-- o asignado a mano.
CREATE TABLE IF NOT EXISTS proyectos (
  id BIGSERIAL PRIMARY KEY,
  nombre TEXT NOT NULL UNIQUE,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS movimientos (
  id BIGSERIAL PRIMARY KEY,
  trimestre_id TEXT NOT NULL REFERENCES trimestres(id) ON DELETE CASCADE,
  hoja TEXT NOT NULL,                 -- bbva | openbank | paypal
  fila INT NOT NULL,                  -- fila original en el excel subido, para el export final
  fecha DATE,
  concepto TEXT NOT NULL,
  importe NUMERIC(12,2) NOT NULL,
  clave TEXT NOT NULL,                -- clave normalizada (lib/normalize.js)
  estado TEXT NOT NULL DEFAULT 'sin_resolver', -- sin_resolver | resuelta | pedida_pendiente
  nota_final TEXT,
  proyecto_id BIGINT REFERENCES proyectos(id)
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

-- Referencia al excel tal cual se subió, para poder reconstruir el .xlsx final
-- (con formato original) al cerrar el trimestre, sin más que rellenar las notas.
CREATE TABLE IF NOT EXISTS excels_originales (
  trimestre_id TEXT NOT NULL REFERENCES trimestres(id) ON DELETE CASCADE,
  hoja TEXT NOT NULL,
  ruta_blob TEXT NOT NULL,
  PRIMARY KEY (trimestre_id, hoja)
);

CREATE TABLE IF NOT EXISTS memoria_proveedores (
  hoja TEXT NOT NULL,
  clave TEXT NOT NULL,
  nota TEXT NOT NULL,
  veces INT NOT NULL DEFAULT 1,
  PRIMARY KEY (hoja, clave, nota)
);

CREATE INDEX IF NOT EXISTS idx_movimientos_proyecto ON movimientos(proyecto_id);
CREATE INDEX IF NOT EXISTS idx_movimientos_trimestre ON movimientos(trimestre_id);
CREATE INDEX IF NOT EXISTS idx_movimientos_clave ON movimientos(trimestre_id, clave);
CREATE INDEX IF NOT EXISTS idx_facturas_trimestre ON facturas(trimestre_id);
CREATE INDEX IF NOT EXISTS idx_facturas_proveedor ON facturas(trimestre_id, proveedor_clave);
CREATE INDEX IF NOT EXISTS idx_facturas_lote ON facturas(lote_id);
CREATE INDEX IF NOT EXISTS idx_lotes_colaborador ON lotes(colaborador_id);
CREATE INDEX IF NOT EXISTS idx_lotes_trimestre ON lotes(trimestre_id);
CREATE INDEX IF NOT EXISTS idx_pagos_lote ON pagos(lote_id);
