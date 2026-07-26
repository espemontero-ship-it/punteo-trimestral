import { NextResponse } from 'next/server';
const { sesionValida, SESSION_COOKIE } = require('./lib/auth.cjs');

const PUBLICAS = ['/login', '/api/login'];

export async function proxy(request) {
  const { pathname } = request.nextUrl;
  if (PUBLICAS.some(p => pathname === p || pathname.startsWith(p + '/'))) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const valido = await sesionValida(token);
  if (valido) return NextResponse.next();

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = '/login';
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
