ALTER TABLE lotes ADD COLUMN IF NOT EXISTS proyecto_id BIGINT REFERENCES proyectos(id);
ALTER TABLE tokens_acceso ADD COLUMN IF NOT EXISTS proyecto_id BIGINT REFERENCES proyectos(id);

INSERT INTO proyectos (nombre)
SELECT DISTINCT evento FROM lotes
WHERE evento IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM proyectos p WHERE p.nombre = lotes.evento)
ON CONFLICT (nombre) DO NOTHING;

UPDATE lotes SET proyecto_id = p.id
FROM proyectos p
WHERE p.nombre = lotes.evento AND lotes.proyecto_id IS NULL;

UPDATE tokens_acceso SET proyecto_id = p.id
FROM proyectos p
WHERE p.nombre = tokens_acceso.proyecto AND tokens_acceso.proyecto_id IS NULL;

ALTER TABLE lotes ALTER COLUMN proyecto_id SET NOT NULL;
