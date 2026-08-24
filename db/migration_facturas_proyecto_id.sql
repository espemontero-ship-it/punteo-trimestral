ALTER TABLE facturas ADD COLUMN IF NOT EXISTS proyecto_id BIGINT REFERENCES proyectos(id);
CREATE INDEX IF NOT EXISTS idx_facturas_proyecto ON facturas(proyecto_id);
