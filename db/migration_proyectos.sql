-- Migración incremental para bases ya desplegadas (de antes de que existiera
-- la lista fija de proyectos/eventos).

CREATE TABLE IF NOT EXISTS proyectos (
  id BIGSERIAL PRIMARY KEY,
  nombre TEXT NOT NULL UNIQUE,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE movimientos ADD COLUMN IF NOT EXISTS proyecto_id BIGINT REFERENCES proyectos(id);

CREATE INDEX IF NOT EXISTS idx_movimientos_proyecto ON movimientos(proyecto_id);
