-- Migración incremental: quién subió una factura general (no ligada a un
-- lote). Toda sesión que sube una tiene colaborador_id (admin incluida,
-- desde que su cuenta también es una fila de colaboradores) salvo el acceso
-- de emergencia con AUTH_PASSWORD, que se queda sin asignar. Idempotente.

ALTER TABLE facturas ADD COLUMN IF NOT EXISTS subido_por BIGINT REFERENCES colaboradores(id);
