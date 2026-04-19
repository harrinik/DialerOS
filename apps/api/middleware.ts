/**
 * ISSUE-07 fix: Middleware matcher covers /dashboard/* and all protected routes.
 * Auth routes (/login /register /forgot-password /api/auth/*) are explicitly excluded.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// NOTE: jsonwebtoken uses Node.js APIs not available in the Edge runtime.
// We decode the JWT manually (without verification) in middleware — the real
// signature verification happens server-side in withUser().
// Middleware's job is: redirect unauthenticated users to /login.

function decodeJwtPayload(token: string): { exp?: number } | null {
  try {
    const [, payloadB64] = token.split('.');
    if (!payloadB64) return null;
    const json = Buffer.from(payloadB64, 'base64url').toString('utf-8');
    return JSON.parse(json) as { exp?: number };
  } catch {
    return null;
  }
}

function isTokenExpired(token: string): boolean {
  const payload = decodeJwtPayload(token);
  if (!payload?.exp) return true;
  return Date.now() / 1000 > payload.exp;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Root redirect → dashboard (or login if no token)
  if (pathname === '/') {
    const token = request.cookies.get('access_token')?.value;
    const dest = token && !isTokenExpired(token) ? '/dashboard' : '/login';
    return NextResponse.redirect(new URL(dest, request.url));
  }

  // Guard all /dashboard/* routes
  if (pathname.startsWith('/dashboard')) {
    const token = request.cookies.get('access_token')?.value;

    if (!token || isTokenExpired(token)) {
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('redirect', pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all paths EXCEPT:
     * - /api/auth/* (login, register, refresh, forgot-password)
     * - /api/health (public)
     * - /_next/* (Next.js internals)
     * - /favicon.ico, /robots.txt, static files
     * - /login /register /forgot-password (auth pages themselves)
     */
    '/((?!api/auth|api/health|_next/static|_next/image|favicon.ico|robots.txt|login|register|forgot-password).*)',
  ],
};
