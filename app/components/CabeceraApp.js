'use client';

import { useState } from 'react';

export const PESTANAS = [
  { id: 'inicio', etiqueta: 'Inicio' },
  { id: 'movimientos', etiqueta: 'Movimientos' },
  { id: 'facturas', etiqueta: 'Facturas' },
  { id: 'proyectos', etiqueta: 'Proyectos' },
  { id: 'colaboradores', etiqueta: 'Colaboradores' },
  { id: 'ayuda', etiqueta: 'Ayuda' },
];

// Cabecera compartida por la SPA de admin (app/page.js, cambia de pestaña sin
// navegar) y por las páginas de detalle sueltas (/lotes/[id], /proyectos/[id]) --
// antes esas páginas no tenían ninguna cabecera y entrar a ver un colaborador
// o un proyecto sacaba por completo de la navegación del admin, solo con un
// botón "Volver" para salir. Sin onCambiarPestana, las pestañas son enlaces a
// "/?tab=x" en vez de botones -- vuelven a la SPA y la dejan en esa pestaña.
export default function CabeceraApp({ pestanaActiva, onCambiarPestana, cerrarSesion }) {
  const [menuMovilAbierto, setMenuMovilAbierto] = useState(false);
  const esSpa = typeof onCambiarPestana === 'function';

  function Pestana({ p, className, onClick }) {
    if (esSpa) {
      return <button type="button" className={className} onClick={onClick}>{p.etiqueta}</button>;
    }
    return <a href={`/?tab=${p.id}`} className={className}>{p.etiqueta}</a>;
  }

  return (
    <>
      <div className="cabecera-app">
        <h1 className="marca">Punteo</h1>
        <nav className="tabs-cabecera">
          {PESTANAS.map(p => (
            <Pestana key={p.id} p={p} className={pestanaActiva === p.id ? 'activa' : ''} onClick={() => onCambiarPestana(p.id)} />
          ))}
        </nav>
        <button type="button" className="btn-menu-movil" onClick={() => setMenuMovilAbierto(true)} aria-label="Abrir menú">☰</button>
        <button type="button" className="secundario" onClick={cerrarSesion}>Cerrar sesión</button>
      </div>

      {menuMovilAbierto && (
        <div className="menu-movil-fondo">
          <div className="menu-movil-cabecera">
            <strong>Punteo</strong>
            <button type="button" className="btn-menu-movil" onClick={() => setMenuMovilAbierto(false)} aria-label="Cerrar menú">✕</button>
          </div>
          <nav className="menu-movil-lista">
            {PESTANAS.map(p => (
              <Pestana
                key={p.id}
                p={p}
                className={pestanaActiva === p.id ? 'activa' : ''}
                onClick={() => { onCambiarPestana(p.id); setMenuMovilAbierto(false); }}
              />
            ))}
            <button onClick={() => { setMenuMovilAbierto(false); cerrarSesion(); }}>Cerrar sesión</button>
          </nav>
        </div>
      )}
    </>
  );
}
