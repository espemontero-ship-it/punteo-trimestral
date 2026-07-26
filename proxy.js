import { NextResponse } from 'next/server';
const { leerSesion, SESSION_COOKIE } = require('./lib/auth.cjs');

const PUBLICAS = ['/login', '/api/login', '/api/logout'];
// Rutas que cualquier sesión válida (admin o colaborador) puede usar.
const COMPARTIDAS = ['/api/blob-upload'];
const PREFIJOS_COLABORADOR = ['/colaborador', '/api/colaborador'];

export async function proxy(request) {
  const { pathname } = request.nextUrl;
  if (PUBLICAS.some(p => pathname === p || pathname.startsWith(p + '/'))) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const sesion = await leerSesion(token);

  if (!sesion) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  if (sesion.rol === 'admin' || COMPARTIDAS.some(p => pathname === p || pathname.startsWith(p + '/'))) {
    return NextResponse.next();
  }

  // Colaborador: solo puede moverse dentro de su propia zona.
  if (PREFIJOS_COLABORADOR.some(p => pathname === p || pathname.startsWith(p + '/'))) {
    return NextResponse.next();
  }

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
  }
  const url = request.nextUrl.clone();
  url.pathname = '/colaborador';
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
