-- Migración incremental: la cuenta de administradora pasa a ser una fila más
-- en `colaboradores` (rol='admin'), reutilizando el mismo sistema de
-- usuario+contraseña recuperable que ya tienen los colaboradores. La
-- contraseña única en AUTH_PASSWORD se mantiene como acceso de emergencia,
-- sin tocar. Idempotente -- seguro re-ejecutar.

ALTER TABLE colaboradores ADD COLUMN IF NOT EXISTS rol TEXT NOT NULL DEFAULT 'colaborador'; -- colaborador | admin
