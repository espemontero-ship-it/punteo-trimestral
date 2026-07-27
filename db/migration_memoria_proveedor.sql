-- Memoria aprendida para el nombre corto de Proveedor, igual que
-- memoria_proveedores aprende la Nota por clave.

CREATE TABLE IF NOT EXISTS memoria_proveedor_nombre (
  hoja TEXT NOT NULL,
  clave TEXT NOT NULL,
  nombre TEXT NOT NULL,
  veces INT NOT NULL DEFAULT 1,
  PRIMARY KEY (hoja, clave, nombre)
);
