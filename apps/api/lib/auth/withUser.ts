import { NextResponse, type NextRequest } from 'next/server';
import { verifyAccessToken, extractBearerToken, type JwtPayload } from './jwt';

type AuthedHandler = (req: NextRequest, user: JwtPayload) => Promise<NextResponse>;

/**
 * Higher-order route wrapper that validates the Bearer JWT token.
 * Usage:
 *   export const GET = withUser(async (req, user) => { ... });
 *   export const POST = withUser(async (req, user) => { ... });
 */
export function withUser(handler: AuthedHandler): (req: NextRequest) => Promise<NextResponse> {
  return async (req: NextRequest): Promise<NextResponse> => {
    try {
      const authHeader = req.headers.get('authorization');
      const cookieToken = req.cookies.get('access_token')?.value ?? null;
      const token = extractBearerToken(authHeader) ?? cookieToken;

      if (!token) {
        return NextResponse.json({ error: 'Unauthorized — no token provided' }, { status: 401 });
      }

      const user = verifyAccessToken(token);
      return await handler(req, user);
    } catch {
      return NextResponse.json({ error: 'Unauthorized — invalid or expired token' }, { status: 401 });
    }
  };
}
