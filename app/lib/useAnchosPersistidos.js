'use client';

import { useState, useEffect } from 'react';

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
