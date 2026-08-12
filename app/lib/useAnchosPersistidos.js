'use client';

import { useState, useEffect } from 'react';

// Los anchos de columna que se ajustan a mano (arrastrando el borde de una
// cabecera) se guardan en este navegador -- si no, cada vez que se recarga
// la página o se vuelve a entrar hay que reajustarlos otra vez.
export function useAnchosPersistidos(clave) {
  const [anchos, setAnchos] = useState({});

  useEffect(() => {
    try {
      const guardado = localStorage.getItem(clave);
      if (guardado) setAnchos(JSON.parse(guardado));
    } catch {}
  }, [clave]);

  useEffect(() => {
    if (Object.keys(anchos).length === 0) return;
    try { localStorage.setItem(clave, JSON.stringify(anchos)); } catch {}
  }, [clave, anchos]);

  return [anchos, setAnchos];
}
