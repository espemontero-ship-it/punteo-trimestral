-- Migración incremental: lotes.evento y tokens_acceso.proyecto eran texto
-- libre, sin relación real con la tabla proyectos -- se añade la relación de
-- verdad (proyecto_id) sin borrar las columnas de texto existentes.
-- Idempotente -- seguro re-ejecutar.

ALTER TABLE lotes ADD COLUMN IF NOT EXISTS proyecto_id BIGINT REFERENCES proyectos(id);
ALTER TABLE tokens_acceso ADD COLUMN IF NOT EXISTS proyecto_id BIGINT REFERENCES proyectos(id);

-- Por si hay lotes de antes de que existiera la tabla proyectos (evento no
-- coincide con ningún proyecto ya creado): se crea el proyecto que falte a
-- partir del propio nombre, para que ningún lote se quede sin proyecto_id.
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

-- El backfill de arriba crea el proyecto que falte a partir de evento, así que
-- todo lote (evento es NOT NULL) queda siempre con proyecto_id relleno.
ALTER TABLE lotes ALTER COLUMN proyecto_id SET NOT NULL;

-- lotes.evento y tokens_acceso.proyecto se quedan tal cual (no se borran) --
-- código nuevo deja de escribirlos, pero el histórico de texto se conserva.
