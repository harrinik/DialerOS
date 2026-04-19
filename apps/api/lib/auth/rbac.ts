import { NextResponse, type NextRequest } from 'next/server';
import { verifyAccessToken, extractBearerToken, type JwtPayload } from './jwt';
import type { UserRole } from '@dialer/shared';

/**
 * withAuth — RBAC middleware factory for Next.js App Router route handlers.
 *
 * Next.js passes a second `context` argument to route handlers containing
 * `{ params }` for dynamic segments (e.g. /api/campaigns/[id]).
 * This wrapper preserves that context and forwards it to the inner handler.
 */
export function withAuth<C = unknown>(
  handler: (req: NextRequest, user: JwtPayload, context: C) => Promise<NextResponse>,
  allowedRoles?: UserRole[],
) {
  return async (req: NextRequest, context: C): Promise<NextResponse> => {
    const token = extractBearerToken(req.headers.get('authorization'));

    if (!token) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 },
      );
    }

    let user: JwtPayload;
    try {
      user = verifyAccessToken(token);
    } catch {
      return NextResponse.json(
        { error: 'Invalid or expired token' },
        { status: 401 },
      );
    }

    if (allowedRoles && !allowedRoles.includes(user.role)) {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 },
      );
    }

    return handler(req, user, context);
  };
}

/** Admin-only route guard */
export function withAdmin<C = unknown>(
  handler: (req: NextRequest, user: JwtPayload, context: C) => Promise<NextResponse>,
) {
  return withAuth<C>(handler, ['admin']);
}

/** Admin or user route guard (not agent) */
export function withUser<C = unknown>(
  handler: (req: NextRequest, user: JwtPayload, context: C) => Promise<NextResponse>,
) {
  return withAuth<C>(handler, ['admin', 'user']);
}
