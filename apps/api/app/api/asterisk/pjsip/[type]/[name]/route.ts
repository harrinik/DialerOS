import { NextResponse, type NextRequest } from 'next/server';
import { connectDb } from '@/lib/db/connection';
import { AsteriskSettings } from '@/lib/db/models/AsteriskSettings';
import { AuditLog } from '@/lib/db/models/AuditLog';
import { withAuth } from '@/lib/auth/rbac';
import type { JwtPayload } from '@/lib/auth/jwt';

type RouteParams = { params: { type: string; name: string } };

const VALID_TYPES = ['endpoint', 'auth', 'aor', 'identify', 'transport', 'registration'];

async function getAriConfig() {
  await connectDb();
  const s = await AsteriskSettings.findOne({}).lean();
  if (!s) throw new Error('Asterisk not configured');
  return {
    host: s.ariHost,
    port: s.ariPort,
    user: s.ariUser,
    password: s.ariPassword,
    ssl: s.ariSsl ?? false,
  };
}

function ariRequest(method: string, path: string, body?: unknown) {
  return getAriConfig().then(async (cfg) => {
    const scheme = cfg.ssl ? 'https' : 'http';
    const url = `${scheme}://${cfg.host}:${cfg.port}/ari${path}`;
    const auth = `Basic ${Buffer.from(`${cfg.user}:${cfg.password}`).toString('base64')}`;
    return fetch(url, {
      method,
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(10_000),
    });
  });
}

function ariGet<T = unknown>(path: string): Promise<T> {
  return ariRequest('GET', path).then((r) => r.json() as Promise<T>);
}

function ariPost<T = unknown>(path: string, body?: unknown): Promise<T | null> {
  return ariRequest('POST', path, body).then((r) => {
    if (r.status === 204) return null;
    return r.json() as Promise<T>;
  });
}

function ariDelete(path: string): Promise<void> {
  return ariRequest('DELETE', path).then(() => undefined);
}

function ariPut<T = unknown>(path: string, body?: unknown): Promise<T | null> {
  return ariRequest('PUT', path, body).then((r) => {
    if (r.status === 204) return null;
    return r.json() as Promise<T>;
  });
}

export const GET = withAuth(async (_req: NextRequest, _user: JwtPayload, { params }: RouteParams) => {
  const { type, name } = params;
  if (!VALID_TYPES.includes(type)) {
    return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
  }

  try {
    const data = await ariGet<Record<string, unknown>>(`/${type}/${name}`);
    return NextResponse.json({ data });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}, ['admin', 'user']);

export const PATCH = withAuth(async (req: NextRequest, user: JwtPayload, { params }: RouteParams) => {
  const { type, name } = params;
  if (!VALID_TYPES.includes(type)) {
    return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
  }

  const body = await req.json();

  try {
    const result = await ariPut<Record<string, unknown>>(`/${type}/${name}`, body);

    await AuditLog.create({
      userId: user.sub,
      action: 'asterisk.pjsip.update',
      resource: 'PJSIP',
      resourceId: `${type}/${name}`,
      metadata: body,
      ip: req.headers.get('x-forwarded-for') ?? '0.0.0.0',
    });

    return NextResponse.json({ data: result });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}, ['admin']);

export const DELETE = withAuth(async (req: NextRequest, user: JwtPayload, { params }: RouteParams) => {
  const { type, name } = params;
  if (!VALID_TYPES.includes(type)) {
    return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
  }

  try {
    await ariDelete(`/${type}/${name}`);

    await AuditLog.create({
      userId: user.sub,
      action: 'asterisk.pjsip.delete',
      resource: 'PJSIP',
      resourceId: `${type}/${name}`,
      metadata: {},
      ip: req.headers.get('x-forwarded-for') ?? '0.0.0.0',
    });

    return NextResponse.json({ message: 'Deleted' });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}, ['admin']);
