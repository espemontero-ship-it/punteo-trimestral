CREATE TABLE IF NOT EXISTS importaciones (
  id BIGSERIAL PRIMARY KEY,
  hoja TEXT NOT NULL,
  ruta_blob TEXT NOT NULL,
  nombre_archivo TEXT,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS envios_gestoria (
  id BIGSERIAL PRIMARY KEY,
  etiqueta TEXT,
  desde DATE,
  hasta DATE,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO importaciones (hoja, ruta_blob, creado_en)
SELECT hoja, ruta_blob, now() FROM excels_originales;

ALTER TABLE movimientos ADD COLUMN IF NOT EXISTS importacion_id BIGINT REFERENCES importaciones(id) ON DELETE SET NULL;
ALTER TABLE movimientos ADD COLUMN IF NOT EXISTS envio_id BIGINT REFERENCES envios_gestoria(id) ON DELETE SET NULL;

UPDATE movimientos m
SET importacion_id = i.id
FROM excels_originales e
JOIN importaciones i ON i.hoja = e.hoja AND i.ruta_blob = e.ruta_blob
WHERE m.trimestre_id = e.trimestre_id AND m.hoja = e.hoja AND m.importacion_id IS NULL;

ALTER TABLE movimientos DROP COLUMN IF EXISTS trimestre_id;

ALTER TABLE facturas ALTER COLUMN trimestre_id DROP NOT NULL;
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS envio_id BIGINT REFERENCES envios_gestoria(id) ON DELETE SET NULL;
UPDATE facturas SET trimestre_id = NULL WHERE lote_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_movimientos_clave ON movimientos(clave);
CREATE INDEX IF NOT EXISTS idx_movimientos_importacion ON movimientos(importacion_id);
CREATE INDEX IF NOT EXISTS idx_movimientos_envio ON movimientos(envio_id);
CREATE INDEX IF NOT EXISTS idx_facturas_envio ON facturas(envio_id);
