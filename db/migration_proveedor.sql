-- Migración incremental: Proveedor pasa a ser un campo corto y editable por
-- movimiento, en vez de repetir el texto de la clave de agrupación.

ALTER TABLE movimientos ADD COLUMN IF NOT EXISTS proveedor TEXT;
