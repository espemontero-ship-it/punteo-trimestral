-- Guarda el motivo (tipo + detalle) del último intento de match de cada
-- factura, para poder mostrarlo siempre en la pantalla de facturas sin tener
-- que volver a recalcular cada vez que se recarga.
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS motivo_tipo TEXT;
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS motivo_detalle TEXT;
