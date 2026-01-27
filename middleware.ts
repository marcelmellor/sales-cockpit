import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';

export default auth((req) => {
  const { nextUrl } = req;
  const isLoggedIn = !!req.auth;

  // Public routes that don't require authentication
  const publicRoutes = ['/login', '/api/auth', '/api/debug', '/api/test-token'];
  const isPublicRoute = publicRoutes.some((route) =>
    nextUrl.pathname.startsWith(route)
  );

  // Redirect unauthenticated users to login
  if (!isLoggedIn && !isPublicRoute) {
    const loginUrl = new URL('/login', nextUrl.origin);
    loginUrl.searchParams.set('callbackUrl', nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Redirect authenticated users away from login page
  if (isLoggedIn && nextUrl.pathname === '/login') {
    return NextResponse.redirect(new URL('/', nextUrl.origin));
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
