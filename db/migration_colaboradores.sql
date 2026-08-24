CREATE TABLE IF NOT EXISTS colaboradores (
  id BIGSERIAL PRIMARY KEY,
  nombre TEXT NOT NULL,
  usuario TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lotes (
  id BIGSERIAL PRIMARY KEY,
  trimestre_id TEXT NOT NULL REFERENCES trimestres(id) ON DELETE CASCADE,
  colaborador_id BIGINT NOT NULL REFERENCES colaboradores(id) ON DELETE CASCADE,
  evento TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'abierto',
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE facturas ALTER COLUMN proveedor_clave DROP NOT NULL;
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS lote_id BIGINT REFERENCES lotes(id) ON DELETE CASCADE;
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS concepto TEXT;
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS importe_declarado NUMERIC(12,2);
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS estado_revision TEXT;
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS motivo_rechazo TEXT;

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

CREATE INDEX IF NOT EXISTS idx_facturas_lote ON facturas(lote_id);
CREATE INDEX IF NOT EXISTS idx_lotes_colaborador ON lotes(colaborador_id);
CREATE INDEX IF NOT EXISTS idx_lotes_trimestre ON lotes(trimestre_id);
CREATE INDEX IF NOT EXISTS idx_pagos_lote ON pagos(lote_id);
