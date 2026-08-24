CREATE TABLE IF NOT EXISTS sugerencias_rechazadas (
  hoja TEXT NOT NULL,
  clave TEXT NOT NULL,
  tipo TEXT NOT NULL,
  valor TEXT NOT NULL DEFAULT '',
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (hoja, clave, tipo, valor)
);
