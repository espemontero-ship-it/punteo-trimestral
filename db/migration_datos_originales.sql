-- Migración incremental para bases ya desplegadas (de antes de que se
-- guardara la fila completa del excel original).

ALTER TABLE movimientos ADD COLUMN IF NOT EXISTS datos_originales JSONB;
