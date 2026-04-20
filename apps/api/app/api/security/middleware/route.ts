import { NextResponse, type NextRequest } from 'next/server';
import crypto from 'crypto';

const CSRF_TOKEN_BYTES = 32;

function generateCsrfToken(): string {
  return crypto.randomBytes(CSRF_TOKEN_BYTES).toString('base64url');
}

const CSRF_HEADER = 'x-csrf-token';
const CSRF_HEADER_REFERER = 'referer';

export function middleware(request: NextRequest) {
  const response = NextResponse.next();

  // Add security headers
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-XSS-Protection', '1; mode=block');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  return response;
}

export const config = {
  matcher: '/api/:path*',
};

export const GET = (req: NextRequest) => {
  const token = generateCsrfToken();
  const response = NextResponse.json({ token });

  response.headers.set(CSRF_HEADER, token);
  response.headers.set('Cache-Control', 'no-store, private');
  response.headers.set('X-Content-Type-Options', 'nosniff');

  return response;
};