-- Sugerencias que la usuaria ha rechazado con la ✕, para siempre.
--
-- Hasta ahora el rechazo solo duraba mientras no se recargara la página: la ✕
-- guardaba en memoria del navegador y al volver salían todas otra vez.
--
-- El rechazo se guarda por TIPO DE MOVIMIENTO (hoja + clave), no por línea:
-- decir que no una vez vale para todas las líneas de ese tipo, las de ahora y
-- las que lleguen después.
--
-- `valor` guarda QUÉ se rechazó, para no bloquear de más: rechazar el proyecto
-- "Glitz" en un tipo de movimiento no impide que mañana se proponga "Wield 2".
-- Para las sugerencias que no tienen valor (la de devolución es un sí/no) se
-- guarda cadena vacía.
--
-- Las sugerencias de nota y de proveedor NO pasan por aquí: esas salen de lo
-- que la usuaria confirmó antes, así que rechazarlas es borrar lo aprendido
-- (memoria_proveedores y memoria_proveedor_nombre). Ver lib/memoria.cjs.
CREATE TABLE IF NOT EXISTS sugerencias_rechazadas (
  hoja TEXT NOT NULL,
  clave TEXT NOT NULL,
  tipo TEXT NOT NULL,                 -- proyecto | devolucion | jugador
  valor TEXT NOT NULL DEFAULT '',     -- lo rechazado; '' si el tipo no tiene valor
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (hoja, clave, tipo, valor)
);
