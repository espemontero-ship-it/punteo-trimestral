-- Esquema para Postgres (Neon, vía integración de Vercel).
-- Ejecutar una vez contra la base nueva antes de usar la webapp.

CREATE TABLE IF NOT EXISTS trimestres (
  id TEXT PRIMARY KEY,               -- ej. '2026-Q3'
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  cerrado BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS facturas (
  id BIGSERIAL PRIMARY KEY,
  trimestre_id TEXT NOT NULL REFERENCES trimestres(id) ON DELETE CASCADE,
  proveedor_clave TEXT NOT NULL,
  ruta_blob TEXT NOT NULL,
  nombre_original TEXT,
  numero INT,                         -- número asignado para la entrega final a Drive
  importes NUMERIC(12,2)[] NOT NULL DEFAULT '{}',
  totales NUMERIC(12,2)[] NOT NULL DEFAULT '{}',
  fechas DATE[] NOT NULL DEFAULT '{}',
  es_imagen BOOLEAN NOT NULL DEFAULT false,
  estado TEXT NOT NULL DEFAULT 'sin_match', -- sin_match | matcheada | revisar
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
  nota_final TEXT
);

CREATE TABLE IF NOT EXISTS movimiento_facturas (
  movimiento_id BIGINT NOT NULL REFERENCES movimientos(id) ON DELETE CASCADE,
  factura_id BIGINT NOT NULL REFERENCES facturas(id) ON DELETE CASCADE,
  PRIMARY KEY (movimiento_id, factura_id)
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

CREATE INDEX IF NOT EXISTS idx_movimientos_trimestre ON movimientos(trimestre_id);
CREATE INDEX IF NOT EXISTS idx_movimientos_clave ON movimientos(trimestre_id, clave);
CREATE INDEX IF NOT EXISTS idx_facturas_trimestre ON facturas(trimestre_id);
CREATE INDEX IF NOT EXISTS idx_facturas_proveedor ON facturas(trimestre_id, proveedor_clave);
