-- Migración incremental: estado de colaborador (activo/inactivo) y cierre
-- por-factura (estado_revision = 'cerrada' + fecha en que se cerró).
-- Idempotente -- seguro re-ejecutar.

ALTER TABLE colaboradores ADD COLUMN IF NOT EXISTS estado TEXT NOT NULL DEFAULT 'activo';
-- valores: activo | inactivo (sin CHECK -- estado_revision de facturas tampoco
-- tiene uno, se mantiene la convención existente de validar solo en JS).

ALTER TABLE facturas ADD COLUMN IF NOT EXISTS fecha_cierre DATE;
-- estado_revision gana dos valores nuevos, sin migración de esquema (ya era
-- TEXT sin CHECK, igual que 'factura_futura'/'ignorada' en movimientos.estado):
--   borrada  -- soft-delete; excluida de TODAS las sumas de calcularTotales
--   cerrada  -- aceptada + ya liquidada; requiere fecha_cierre; bloquea más ediciones
