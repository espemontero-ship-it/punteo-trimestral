ALTER TABLE importaciones ADD COLUMN IF NOT EXISTS origen TEXT NOT NULL DEFAULT 'banco';

ALTER TABLE larpmanager_pagos ADD COLUMN IF NOT EXISTS importacion_id BIGINT
  REFERENCES importaciones(id) ON DELETE SET NULL;

ALTER TABLE larpmanager_pagos ADD COLUMN IF NOT EXISTS datos_originales JSONB;

ALTER TABLE larpmanager_pagos ADD COLUMN IF NOT EXISTS entra_en_cruce BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE larpmanager_pagos ADD COLUMN IF NOT EXISTS firma TEXT;
ALTER TABLE larpmanager_pagos ADD COLUMN IF NOT EXISTS orden INT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_larpmanager_pagos_importacion ON larpmanager_pagos(importacion_id);

DROP INDEX IF EXISTS larpmanager_pagos_natural_key;
CREATE UNIQUE INDEX IF NOT EXISTS larpmanager_pagos_firma_key
  ON larpmanager_pagos(firma, orden);
