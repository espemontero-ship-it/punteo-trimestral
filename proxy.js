import { NextResponse } from 'next/server';
const { leerSesion, SESSION_COOKIE } = require('./lib/auth.cjs');

const PUBLICAS = [
  '/login', '/api/login', '/api/logout',
  '/recuperar', '/api/recuperar',
  '/restablecer', '/api/restablecer',
  '/invitacion', '/api/invitaciones',
];
// Rutas que cualquier sesión válida (admin o colaborador) puede usar.
const COMPARTIDAS = ['/api/blob-upload', '/api/facturas/huella'];
const PREFIJOS_COLABORADOR = ['/colaborador', '/api/colaborador'];

export async function proxy(request) {
  const { pathname } = request.nextUrl;
  if (PUBLICAS.some(p => pathname === p || pathname.startsWith(p + '/'))) {
    return NextResponse.next();
  }

  // En local (npm run dev) no se pide contraseña: se entra directo como
  // administradora. En producción NODE_ENV es 'production' y esto no se
  // ejecuta nunca, así que el login sigue exactamente igual de cerrado.
  //
  // Existe para que se pueda mirar la aplicación de verdad mientras se
  // trabaja en ella. Sin esto había que hacer el desarrollo a ciegas --
  // maquetas sueltas y capturas de pantalla-- porque no se podía abrir ni una
  // pantalla, y eso hizo perder horas y meter cosas rotas sin enterarse.
  //
  // Lo que se pierde: quien pueda arrancar la app en este ordenador entra sin
  // contraseña. Como para arrancarla hace falta tener los archivos del
  // proyecto, y la contraseña está en .env.local en texto plano, no abre
  // ninguna puerta que no estuviera abierta ya.
  if (process.env.NODE_ENV !== 'production') {
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
