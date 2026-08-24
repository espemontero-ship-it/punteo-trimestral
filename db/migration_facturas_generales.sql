ALTER TABLE colaboradores ADD COLUMN IF NOT EXISTS puede_subir_facturas_generales BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE tokens_acceso ADD COLUMN IF NOT EXISTS puede_subir_facturas_generales BOOLEAN NOT NULL DEFAULT false;
