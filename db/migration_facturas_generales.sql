-- Migración incremental: permiso para subir facturas generales de NOL (no
-- ligadas a ningún proyecto/lote) -- ortogonal a ser colaborador de un
-- proyecto, así que una misma persona puede tener las dos cosas a la vez.
-- Idempotente -- seguro re-ejecutar.

ALTER TABLE colaboradores ADD COLUMN IF NOT EXISTS puede_subir_facturas_generales BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE tokens_acceso ADD COLUMN IF NOT EXISTS puede_subir_facturas_generales BOOLEAN NOT NULL DEFAULT false;
