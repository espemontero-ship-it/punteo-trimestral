CREATE TABLE IF NOT EXISTS trimestres (
  id TEXT PRIMARY KEY,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  cerrado BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS colaboradores (
  id BIGSERIAL PRIMARY KEY,
  nombre TEXT NOT NULL,
  usuario TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'activo',
  puede_invitar BOOLEAN NOT NULL DEFAULT false,
  puede_subir_facturas_generales BOOLEAN NOT NULL DEFAULT false,
  rol TEXT NOT NULL DEFAULT 'colaborador',
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS proyectos (
  id BIGSERIAL PRIMARY KEY,
  nombre TEXT NOT NULL UNIQUE,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tokens_acceso (
  id BIGSERIAL PRIMARY KEY,
  tipo TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  colaborador_id BIGINT REFERENCES colaboradores(id) ON DELETE CASCADE,
  nombre TEXT,
  usuario TEXT,
  proyecto TEXT,
  proyecto_id BIGINT REFERENCES proyectos(id),
  puede_subir_facturas_generales BOOLEAN NOT NULL DEFAULT false,
  invitado_por BIGINT REFERENCES colaboradores(id),
  expira_en TIMESTAMPTZ NOT NULL,
  usado_en TIMESTAMPTZ,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lotes (
  id BIGSERIAL PRIMARY KEY,
  trimestre_id TEXT NOT NULL REFERENCES trimestres(id) ON DELETE CASCADE,
  colaborador_id BIGINT NOT NULL REFERENCES colaboradores(id) ON DELETE CASCADE,
  evento TEXT NOT NULL,
  proyecto_id BIGINT NOT NULL REFERENCES proyectos(id),
  estado TEXT NOT NULL DEFAULT 'abierto',
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS envios_gestoria (
  id BIGSERIAL PRIMARY KEY,
  etiqueta TEXT,
  desde DATE,
  hasta DATE,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS facturas (
  id BIGSERIAL PRIMARY KEY,
  trimestre_id TEXT REFERENCES trimestres(id) ON DELETE CASCADE,
  envio_id BIGINT REFERENCES envios_gestoria(id) ON DELETE SET NULL,
  proveedor_clave TEXT,
  ruta_blob TEXT NOT NULL,
  nombre_original TEXT,
  numero INT,
  importes NUMERIC(12,2)[] NOT NULL DEFAULT '{}',
  totales NUMERIC(12,2)[] NOT NULL DEFAULT '{}',
  fechas DATE[] NOT NULL DEFAULT '{}',
  es_imagen BOOLEAN NOT NULL DEFAULT false,
  estado TEXT NOT NULL DEFAULT 'sin_match',
  motivo_tipo TEXT,
  motivo_detalle TEXT,
  motivo_candidatos JSONB,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  subido_por BIGINT REFERENCES colaboradores(id),

  lote_id BIGINT REFERENCES lotes(id) ON DELETE CASCADE,
  concepto TEXT,
  importe_declarado NUMERIC(12,2),
  estado_revision TEXT,
  motivo_rechazo TEXT,
  fecha_cierre DATE,
  proyecto_id BIGINT REFERENCES proyectos(id)
);

CREATE TABLE IF NOT EXISTS importaciones (
  id BIGSERIAL PRIMARY KEY,
  hoja TEXT NOT NULL,
  ruta_blob TEXT NOT NULL,
  nombre_archivo TEXT,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS movimientos (
  id BIGSERIAL PRIMARY KEY,
  hoja TEXT NOT NULL,
  fila INT NOT NULL,
  importacion_id BIGINT REFERENCES importaciones(id) ON DELETE SET NULL,
  envio_id BIGINT REFERENCES envios_gestoria(id) ON DELETE SET NULL,
  fecha DATE,
  concepto TEXT NOT NULL,
  importe NUMERIC(12,2) NOT NULL,
  clave TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'sin_resolver',
  nota_final TEXT,
  proveedor TEXT,
  proyecto_id BIGINT REFERENCES proyectos(id),
  es_devolucion BOOLEAN NOT NULL DEFAULT false,
  jugador_larpmanager TEXT,
  larpmanager_candidatos JSONB,
  datos_originales JSONB
);

CREATE TABLE IF NOT EXISTS movimiento_facturas (
  movimiento_id BIGINT NOT NULL REFERENCES movimientos(id) ON DELETE CASCADE,
  factura_id BIGINT NOT NULL REFERENCES facturas(id) ON DELETE CASCADE,
  PRIMARY KEY (movimiento_id, factura_id)
);

CREATE TABLE IF NOT EXISTS pagos (
  id BIGSERIAL PRIMARY KEY,
  lote_id BIGINT NOT NULL REFERENCES lotes(id) ON DELETE CASCADE,
  importe NUMERIC(12,2) NOT NULL,
  fecha DATE,
  nota TEXT,
  movimiento_id BIGINT REFERENCES movimientos(id),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pago_facturas (
  pago_id BIGINT NOT NULL REFERENCES pagos(id) ON DELETE CASCADE,
  factura_id BIGINT NOT NULL REFERENCES facturas(id) ON DELETE CASCADE,
  PRIMARY KEY (pago_id, factura_id)
);

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
