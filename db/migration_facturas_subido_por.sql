-- Migración incremental: quién subió cada factura general (admin o
-- colaborador con puede_subir_facturas_generales) -- NULL si fue el acceso
-- de emergencia (AUTH_PASSWORD, sin fila de colaborador que atribuirle).
-- Idempotente -- seguro re-ejecutar.

ALTER TABLE facturas ADD COLUMN IF NOT EXISTS subido_por BIGINT REFERENCES colaboradores(id);
