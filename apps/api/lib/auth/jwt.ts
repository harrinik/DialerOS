import jwt, { type SignOptions } from 'jsonwebtoken';
import type { UserRole } from '@dialer/shared';

export interface JwtPayload {
  sub: string;     // User ID
  email: string;
  role: UserRole;
  iat?: number;
  exp?: number;
}

function getSecrets() {
  const ACCESS_SECRET  = process.env['JWT_ACCESS_SECRET'];
  const REFRESH_SECRET = process.env['JWT_REFRESH_SECRET'];
  if (!ACCESS_SECRET || !REFRESH_SECRET) {
    throw new Error('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be set in environment');
  }
  return { ACCESS_SECRET, REFRESH_SECRET };
}

const ACCESS_EXPIRES  = process.env['JWT_ACCESS_EXPIRES_IN']  ?? '15m';
const REFRESH_EXPIRES = process.env['JWT_REFRESH_EXPIRES_IN'] ?? '7d';

/** Sign a short-lived access token */
export function signAccessToken(payload: Omit<JwtPayload, 'iat' | 'exp'>): string {
  return jwt.sign(payload, getSecrets().ACCESS_SECRET, { expiresIn: ACCESS_EXPIRES } as SignOptions);
}

/** Sign a long-lived refresh token */
export function signRefreshToken(payload: Omit<JwtPayload, 'iat' | 'exp'>): string {
  return jwt.sign(payload, getSecrets().REFRESH_SECRET, { expiresIn: REFRESH_EXPIRES } as SignOptions);
}

/** Verify and decode an access token */
export function verifyAccessToken(token: string): JwtPayload {
  return jwt.verify(token, getSecrets().ACCESS_SECRET) as JwtPayload;
}

/** Verify and decode a refresh token */
export function verifyRefreshToken(token: string): JwtPayload {
  return jwt.verify(token, getSecrets().REFRESH_SECRET) as JwtPayload;
}

/** Extract Bearer token from Authorization header */
export function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  return authHeader.slice(7);
}
