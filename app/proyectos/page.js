'use client';

import { useEffect, useState, useCallback } from 'react';
import GestionProyectos from '../components/GestionProyectos';
import CabeceraApp from '../components/CabeceraApp';
import { apiFetch } from '../lib/toast';

async function cerrarSesion() {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/login';
}

export default function ProyectosPage() {
  const [proyectos, setProyectos] = useState(null);

  const cargar = useCallback(async () => {
    const r = await apiFetch('/api/proyectos', undefined, { mensajeError: 'No se pudieron cargar los proyectos.' });
    setProyectos((r && r.proyectos) || []);
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  return (
    <div className="contenedor contenedor-ancho">
      <CabeceraApp pestanaActiva="proyectos" cerrarSesion={cerrarSesion} />
      {proyectos === null ? (
        <p className="muted">Cargando...</p>
      ) : (
        <GestionProyectos proyectos={proyectos} onCambio={cargar} />
      )}
    </div>
  );
}
