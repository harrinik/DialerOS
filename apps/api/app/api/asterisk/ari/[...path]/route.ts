import { NextResponse, type NextRequest } from 'next/server';
import { ariProxy } from '@/lib/asterisk/ari-client';
import { verifyAccessToken, extractBearerToken } from '@/lib/auth/jwt';

type Params = { params: { path: string[] } };

async function handle(req: NextRequest, { params }: Params): Promise<NextResponse> {
  // Auth check
  const token = extractBearerToken(req.headers.get('authorization'));
  if (!token) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  try { verifyAccessToken(token); } catch { return NextResponse.json({ error: 'Invalid token' }, { status: 401 }); }

  const path = '/' + params.path.join('/');
  const qs = req.nextUrl.search ?? '';

  let body: unknown;
  if (req.method !== 'GET' && req.method !== 'DELETE' && req.method !== 'HEAD') {
    try { body = await req.json(); } catch { body = undefined; }
  }

  try {
    const upstream = await ariProxy(req.method, path + qs, body);
    const contentType = upstream.headers.get('content-type') ?? 'application/json';
    const buf = await upstream.arrayBuffer();
    return new NextResponse(buf, {
      status: upstream.status,
      headers: { 'Content-Type': contentType },
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}

export const GET    = handle;
export const POST   = handle;
export const PUT    = handle;
export const DELETE = handle;
