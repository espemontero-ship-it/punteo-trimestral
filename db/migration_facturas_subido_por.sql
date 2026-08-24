ALTER TABLE facturas ADD COLUMN IF NOT EXISTS subido_por BIGINT REFERENCES colaboradores(id);
