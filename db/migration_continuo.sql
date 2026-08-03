-- Migración al modelo continuo (2026-08-02): movimientos y facturas sueltas dejan de
-- vivir en un "trimestre" (partición de datos); trimestre pasa a ser solo un concepto
-- de reporting (envío a gestoría por rango de fechas). Las facturas de lote
-- (colaboradores) mantienen trimestre_id sin cambios -- ese módulo se rediseña aparte.
--
-- Ejecutar una sola vez. Pensado para correr contra una rama de Neon aislada primero
-- (dev), y solo después contra producción con confirmación explícita.

-- Cada excel subido es su propio evento de importación (con fecha), no un singleton
-- por trimestre+hoja -- así se puede subir el mismo banco muchas veces sin que cada
-- subida reemplace a la anterior, y se puede borrar una subida suelta sin perder las demás.
CREATE TABLE IF NOT EXISTS importaciones (
  id BIGSERIAL PRIMARY KEY,
  hoja TEXT NOT NULL,                 -- bbva | openbank | paypal
  ruta_blob TEXT NOT NULL,
  nombre_archivo TEXT,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Un envío a gestoría = el paquete real que se manda (rango de fechas + cuándo se
-- generó). Cada movimiento/factura queda marcado con el envío al que pertenece, para
-- poder añadir a un envío posterior lo que se recupera tarde (ver PROYECTO.md).
CREATE TABLE IF NOT EXISTS envios_gestoria (
  id BIGSERIAL PRIMARY KEY,
  etiqueta TEXT,
  desde DATE,
  hasta DATE,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Migra los excels ya subidos a importaciones antes de tocar movimientos, para no
-- perder de qué archivo venía cada fila.
INSERT INTO importaciones (hoja, ruta_blob, creado_en)
SELECT hoja, ruta_blob, now() FROM excels_originales;

ALTER TABLE movimientos ADD COLUMN IF NOT EXISTS importacion_id BIGINT REFERENCES importaciones(id) ON DELETE SET NULL;
ALTER TABLE movimientos ADD COLUMN IF NOT EXISTS envio_id BIGINT REFERENCES envios_gestoria(id) ON DELETE SET NULL;

-- Empareja cada movimiento con la importación que le corresponde (misma pareja
-- trimestre_id+hoja que tenía su excel original).
UPDATE movimientos m
SET importacion_id = i.id
FROM excels_originales e
JOIN importaciones i ON i.hoja = e.hoja AND i.ruta_blob = e.ruta_blob
WHERE m.trimestre_id = e.trimestre_id AND m.hoja = e.hoja AND m.importacion_id IS NULL;

-- movimientos deja de pertenecer a un trimestre.
ALTER TABLE movimientos DROP COLUMN IF EXISTS trimestre_id;

-- facturas: trimestre_id pasa a ser opcional -- las de lote (colaboradores) lo
-- siguen usando tal cual; las sueltas/de proveedor dejan de tenerlo.
ALTER TABLE facturas ALTER COLUMN trimestre_id DROP NOT NULL;
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS envio_id BIGINT REFERENCES envios_gestoria(id) ON DELETE SET NULL;
UPDATE facturas SET trimestre_id = NULL WHERE lote_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_movimientos_clave ON movimientos(clave);
CREATE INDEX IF NOT EXISTS idx_movimientos_importacion ON movimientos(importacion_id);
CREATE INDEX IF NOT EXISTS idx_movimientos_envio ON movimientos(envio_id);
CREATE INDEX IF NOT EXISTS idx_facturas_envio ON facturas(envio_id);

-- excels_originales queda sin usar (sustituida por importaciones) -- no se borra por
-- si hace falta consultarla, pero el flujo principal ya no escribe ahí.
