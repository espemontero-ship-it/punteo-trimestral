'use client';

import { useEffect, useState, useCallback } from 'react';
import GestionProyectos from '../components/GestionProyectos';
import { apiFetch } from '../lib/toast';

export default function ProyectosPage() {
  const [proyectos, setProyectos] = useState(null);

  const cargar = useCallback(async () => {
    const r = await apiFetch('/api/proyectos', undefined, { mensajeError: 'No se pudieron cargar los proyectos.' });
    setProyectos((r && r.proyectos) || []);
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  return (
    <div className="contenedor" style={{ paddingTop: '8vh' }}>
      <div className="fila" style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>Proyectos</h1>
        <a href="/"><button className="secundario">Volver</button></a>
      </div>

      {proyectos === null ? (
        <p className="muted">Cargando...</p>
      ) : (
        <GestionProyectos proyectos={proyectos} onCambio={cargar} />
      )}
    </div>
  );
}
