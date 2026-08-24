ALTER TABLE colaboradores ADD COLUMN IF NOT EXISTS puede_invitar BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS tokens_acceso (
  id BIGSERIAL PRIMARY KEY,
  tipo TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  colaborador_id BIGINT REFERENCES colaboradores(id) ON DELETE CASCADE,
  nombre TEXT,
  usuario TEXT,
  proyecto TEXT,
  invitado_por BIGINT REFERENCES colaboradores(id),
  expira_en TIMESTAMPTZ NOT NULL,
  usado_en TIMESTAMPTZ,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tokens_acceso_hash ON tokens_acceso(token_hash);
