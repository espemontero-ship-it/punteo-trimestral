-- La importación de LarpManager, al mismo nivel que la del banco.
--
-- Hasta ahora el CSV se procesaba y se tiraba: no quedaba el archivo, ni
-- registro de la subida, ni forma de saber qué pagos vinieron de cuál, ni de
-- deshacer una subida equivocada. De cada fila se guardaban 4 campos y se
-- descartaban `Method` e `Info`, que son justo los que deciden si una fila
-- entra en el cruce -- así que la decisión era irreversible y no se podía
-- auditar. De 75 filas del CSV real, 43 se tiraban sin dejar rastro.

-- 1. La tabla de subidas vale ya para cualquier archivo, no solo excels.
--    `hoja` sigue siendo bbva|openbank|paypal para el banco, y 'larpmanager'
--    para el CSV. `origen` es lo que distingue las dos clases en el listado.
ALTER TABLE importaciones ADD COLUMN IF NOT EXISTS origen TEXT NOT NULL DEFAULT 'banco';

-- 2. De qué subida vino cada pago. Los pagos que ya existían se quedan con
--    NULL: son anteriores a que esto se registrara, siguen funcionando tal
--    cual, y borrar una subida nueva no los toca.
ALTER TABLE larpmanager_pagos ADD COLUMN IF NOT EXISTS importacion_id BIGINT
  REFERENCES importaciones(id) ON DELETE SET NULL;

-- 3. La fila del CSV entera, tal cual llegó, sin decidir qué sobra -- lo mismo
--    que hace el excel del banco con datos_originales.
ALTER TABLE larpmanager_pagos ADD COLUMN IF NOT EXISTS datos_originales JSONB;

-- 4. Se guardan TODAS las filas, también las que el cruce ignora. La decisión
--    queda por escrito y se puede revisar sin volver a subir nada.
ALTER TABLE larpmanager_pagos ADD COLUMN IF NOT EXISTS entra_en_cruce BOOLEAN NOT NULL DEFAULT true;

-- 5. Cómo se sabe que dos filas son la misma al volver a subir el CSV: el
--    archivo no trae ningún identificador de pago, así que dos filas son la
--    misma cuando TODAS sus columnas coinciden (`firma`). Si un mismo CSV
--    trajera dos idénticas de verdad, se guardan las dos y `orden` las
--    distingue (0, 1, 2...). La posición en el archivo no sirve: LarpManager
--    pone los pagos nuevos arriba y desplaza todo lo demás.
ALTER TABLE larpmanager_pagos ADD COLUMN IF NOT EXISTS firma TEXT;
ALTER TABLE larpmanager_pagos ADD COLUMN IF NOT EXISTS orden INT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_larpmanager_pagos_importacion ON larpmanager_pagos(importacion_id);

-- La clave vieja (nombre, evento, importe, fecha) no vale ya: ahora entran
-- también las filas descartadas, y dos filas distintas del CSV pueden
-- coincidir en esos cuatro campos. Las filas antiguas tienen firma NULL y no
-- estorban: Postgres permite varios NULL en un índice único.
DROP INDEX IF EXISTS larpmanager_pagos_natural_key;
CREATE UNIQUE INDEX IF NOT EXISTS larpmanager_pagos_firma_key
  ON larpmanager_pagos(firma, orden);
