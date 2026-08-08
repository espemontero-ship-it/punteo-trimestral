-- Migración incremental: invitaciones y recuperación de contraseña por
-- correo (en vez de contraseñas dictadas a mano), y permiso para que un
-- colaborador concreto pueda invitar a más gente a su mismo proyecto.
-- Idempotente -- seguro re-ejecutar.

ALTER TABLE colaboradores ADD COLUMN IF NOT EXISTS puede_invitar BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS tokens_acceso (
  id BIGSERIAL PRIMARY KEY,
  tipo TEXT NOT NULL,                 -- 'invitacion' | 'restablecimiento'
  token_hash TEXT NOT NULL UNIQUE,    -- SHA-256 del token real; el token en claro solo vive en el correo
  colaborador_id BIGINT REFERENCES colaboradores(id) ON DELETE CASCADE, -- NULL hasta aceptar una invitación
  nombre TEXT,                        -- solo invitacion: nombre de la persona invitada
  usuario TEXT,                       -- solo invitacion: correo de la persona invitada
  proyecto TEXT,                      -- solo invitacion: a qué proyecto se le da de alta
  invitado_por BIGINT REFERENCES colaboradores(id), -- quién mandó la invitación (NULL = admin)
  expira_en TIMESTAMPTZ NOT NULL,
  usado_en TIMESTAMPTZ,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tokens_acceso_hash ON tokens_acceso(token_hash);
