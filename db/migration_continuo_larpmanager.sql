DO $$
DECLARE nombre_constraint text;
BEGIN
  SELECT tc.constraint_name INTO nombre_constraint
  FROM information_schema.table_constraints tc
  WHERE tc.table_name = 'larpmanager_pagos' AND tc.constraint_type = 'UNIQUE';
  IF nombre_constraint IS NOT NULL THEN
    EXECUTE format('ALTER TABLE larpmanager_pagos DROP CONSTRAINT %I', nombre_constraint);
  END IF;
END $$;

ALTER TABLE larpmanager_pagos DROP COLUMN IF EXISTS trimestre_id;
CREATE UNIQUE INDEX IF NOT EXISTS larpmanager_pagos_natural_key ON larpmanager_pagos(nombre_real, evento, importe, fecha);
