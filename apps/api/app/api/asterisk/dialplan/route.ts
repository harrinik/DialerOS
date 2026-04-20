import { NextResponse, type NextRequest } from 'next/server';
import { connectDb } from '@/lib/db/connection';
import { AsteriskSettings } from '@/lib/db/models/AsteriskSettings';
import { AuditLog } from '@/lib/db/models/AuditLog';
import { withAuth } from '@/lib/auth/rbac';
import type { JwtPayload } from '@/lib/auth/jwt';

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
      ...(body !== undefined && { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(10_000),
    });
  });
}

function ariGet<T = unknown>(path: string): Promise<T> {
  return ariRequest('GET', path).then((r) => r.json() as Promise<T>);
}

function ariPost<T = unknown>(path: string, body?: unknown): Promise<T | null> {
  return ariRequest('POST', path, body).then((r) => (r.status === 204 ? null : (r.json() as Promise<T>)));
}

function ariDelete(path: string): Promise<void> {
  return ariRequest('DELETE', path).then(() => undefined);
}

interface DialplanExtension {
  context: string;
  extension: string;
  priority: number;
  app: string;
  appdata: string;
}

// GET /api/asterisk/dialplan - list dialplan
export const GET = withAuth(async (_req: NextRequest, _user: JwtPayload) => {
  try {
    const [extensions, contexts] = await Promise.all([
      ariGet<DialplanExtension[]>('/dialplan/extensions'),
      ariGet<string[]>('/dialplan/contexts'),
    ]);

    return NextResponse.json({
      data: {
        contexts,
        extensions,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}, ['admin', 'user']);

// POST /api/asterisk/dialplan - create/update extension
export const POST = withAuth(async (req: NextRequest, user: JwtPayload) => {
  const body = await req.json() as Record<string, unknown>;

  const context = String(body['context'] ?? 'default').trim();
  const extension = String(body['extension'] ?? '').trim();
  const priority = Number(body['priority'] ?? 1);
  const app = String(body['app'] ?? '').trim();
  const appdata = String(body['appdata'] ?? '');

  if (!extension || !app) {
    return NextResponse.json({ error: 'extension and app are required' }, { status: 400 });
  }

  try {
    const result = await ariPost<DialplanExtension>('/dialplan', {
      context,
      extension,
      priority,
      app,
      appdata,
    });

    await AuditLog.create({
      userId: user.sub,
      action: 'asterisk.dialplan.create',
      resource: 'Dialplan',
      resourceId: `${context}/${extension}`,
      metadata: { context, extension, priority, app, appdata },
      ip: req.headers.get('x-forwarded-for') ?? '0.0.0.0',
    });

    return NextResponse.json({ data: result }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}, ['admin']);

// DELETE /api/asterisk/dialplan - delete extension
export const DELETE = withAuth(async (req: NextRequest, user: JwtPayload) => {
  const { searchParams } = new URL(req.url);
  const context = searchParams.get('context') ?? 'default';
  const extension = searchParams.get('extension');

  if (!extension) {
    return NextResponse.json({ error: 'extension query param required' }, { status: 400 });
  }

  try {
    await ariDelete(`/dialplan/${context}/${extension}`);

    await AuditLog.create({
      userId: user.sub,
      action: 'asterisk.dialplan.delete',
      resource: 'Dialplan',
      resourceId: `${context}/${extension}`,
      metadata: { context, extension },
      ip: req.headers.get('x-forwarded-for') ?? '0.0.0.0',
    });

    return NextResponse.json({ message: 'Deleted' });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}, ['admin']);