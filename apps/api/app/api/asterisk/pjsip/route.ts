import { NextResponse, type NextRequest } from 'next/server';
import { connectDb } from '@/lib/db/connection';
import { AsteriskSettings } from '@/lib/db/models/AsteriskSettings';
import { AuditLog } from '@/lib/db/models/AuditLog';
import { withAuth } from '@/lib/auth/rbac';
import type { JwtPayload } from '@/lib/auth/jwt';

async function getAriBase() {
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

function ariRequest(method: string, path: string, body?: unknown): Promise<Response> {
  return getAriBase().then(async (cfg) => {
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
  return ariRequest('POST', path, body).then((r) => r.json() as Promise<T | null>);
}

function ariDelete(path: string): Promise<void> {
  return ariRequest('DELETE', path).then(() => undefined);
}

function ariPut<T = unknown>(path: string, body?: unknown): Promise<T | null> {
  return ariRequest('PUT', path, body).then((r) => r.status === 204 ? null : (r.json() as Promise<T>));
}

interface PjsipEndpoint {
  endpoint: string;
  aors: string[];
  auth: string;
  transport: string;
  disallow: string;
  allow: string;
  callerid: string;
  mailboxes: string;
  'named-physical-endpoint': string;
  device: string;
}

interface PjsipAuth {
  auth_type: string;
  password: string;
  username: string;
  nonce_type: string;
  md5_cred?: string;
}

interface PjsipAor {
  contact: string;
  qualify_frequency: number;
  max_contacts: number;
  remove_existing: string;
}

interface PjsipIdentify {
  match: string[];
  endpoint: string;
}

interface PjsipTransport {
  type: string;
  protocol: string;
  bind: string;
  async_operations: string;
}

// GET /api/asterisk/pjsip - list all PJSIP configuration
export const GET = withAuth(async (_req: NextRequest, _user: JwtPayload) => {
  try {
    const [endpoints, auths, aors, identifies, transports] = await Promise.all([
      ariGet<PjsipEndpoint[]>('/endpoint'),
      ariGet<PjsipAuth[]>('/auth'),
      ariGet<PjsipAor[]>('/aor'),
      ariGet<PjsipIdentify[]>('/identify'),
      ariGet<PjsipTransport[]>('/transport'),
    ]);

    return NextResponse.json({
      data: {
        endpoints,
        auths,
        aors,
        identifies,
        transports,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}, ['admin', 'user']);

// POST /api/asterisk/pjsip - create PJSIP endpoint with auth and aor
export const POST = withAuth(async (req: NextRequest, user: JwtPayload) => {
  await connectDb();
  const body = await req.json() as Record<string, unknown>;

  const endpointName = String(body['endpoint'] ?? '').trim();
  const authName = String(body['auth'] ?? endpointName).trim();
  const aorName = String(body['aor'] ?? endpointName).trim();
  const transport = String(body['transport'] ?? 'udp').trim();

  if (!endpointName) {
    return NextResponse.json({ error: 'endpoint name is required' }, { status: 400 });
  }

  const payload = body['payload'] as Record<string, unknown> | undefined;

  try {
    const result: Record<string, unknown> = {};

    // Create auth if provided
    if (payload?.['auth']) {
      const authPayload = {
        auth_type: 'userpass',
        password: String(payload['password'] ?? ''),
        username: String(payload['username'] ?? endpointName),
        nonce_type: 'MD5',
        ...(payload['md5_cred'] && { md5_cred: String(payload['md5_cred']) }),
      };
      await ariPost(`/auth/${authName}`, authPayload);
      result.auth = authName;
    }

    // Create aor
    const aorPayload = {
      contact: `sip:${payload?.['contact'] ?? ''}`,
      qualify_frequency: Number(payload?.['qualify_frequency'] ?? 60),
      max_contacts: Number(payload?.['max_contacts'] ?? 1),
      remove_existing: 'yes',
    };
    await ariPost(`/aor/${aorName}`, aorPayload);
    result.aor = aorName;

    // Create identify (if match is provided)
    if (payload?.['match']) {
      const identifyPayload = {
        match: String(payload['match']).split(',').map((m) => m.trim()),
        endpoint: endpointName,
      };
      await ariPost(`/identify/${aorName}`, identifyPayload);
      result.identify = identifyPayload;
    }

    // Create endpoint
    const endpointPayload = {
      endpoint: endpointName,
      aors: [aorName],
      auth: authName,
      transport,
      disallow: String(payload?.['disallow'] ?? 'all'),
      allow: String(payload?.['allow'] ?? 'ulaw'),
      callerid: String(payload?.['callerid'] ?? `Dialer <${endpointName}>`),
      mailboxes: String(payload?.['mailboxes'] ?? ''),
      'named-physical-endpoint': 'endpoint',
      device: 'Softphone',
    };
    await ariPost(`/endpoint/${endpointName}`, endpointPayload);
    result.endpoint = endpointName;

    await AuditLog.create({
      userId: user.sub,
      action: 'asterisk.pjsip.create',
      resource: 'PJSIP',
      resourceId: endpointName,
      metadata: result,
      ip: req.headers.get('x-forwarded-for') ?? '0.0.0.0',
    });

    return NextResponse.json({ data: result }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}, ['admin']);