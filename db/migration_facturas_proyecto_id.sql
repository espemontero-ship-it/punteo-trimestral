-- Facturas generales de NOL (sin lote) ahora pueden llevar un proyecto
-- asociado, para que aparezcan en "Facturas de colaboradores pendientes" de
-- ese proyecto igual que las de lote. Ver PROYECTO.md, registro 2026-08-13.
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS proyecto_id BIGINT REFERENCES proyectos(id);
CREATE INDEX IF NOT EXISTS idx_facturas_proyecto ON facturas(proyecto_id);
