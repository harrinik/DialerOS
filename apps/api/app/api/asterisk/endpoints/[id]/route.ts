import { NextResponse, type NextRequest } from 'next/server';
import {
  deletePjsipEndpoint,
  readPjsipSections,
  upsertPjsipEndpoint,
} from '@/lib/asterisk/pjsip-endpoints';
import { withUser } from '@/lib/auth/rbac';
import type { JwtPayload } from '@/lib/auth/jwt'

// ── GET /api/asterisk/endpoints/[id] ─────────────────────────────────────────
export const GET = withUser(async (_req: NextRequest, _user: JwtPayload, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const sections = await readPjsipSections();
  const endpointSections = sections.filter(s => s.id === id);
  if (endpointSections.length === 0) return NextResponse.json({ error: 'Endpoint not found' }, { status: 404 });

  const ep   = endpointSections.find(s => s.type === 'endpoint');
  const auth = endpointSections.find(s => s.type === 'auth');
  const aor  = endpointSections.find(s => s.type === 'aor');

  return NextResponse.json({
    data: {
      id,
      transport:   ep?.attrs['transport']?.[0]   ?? 'transport-udp',
      codecs:      (ep?.attrs['allow']?.[0]      ?? 'ulaw,alaw').split(','),
      dtmfMode:    ep?.attrs['dtmf_mode']?.[0]   ?? 'rfc4733',
      directMedia: ep?.attrs['direct_media']?.[0] === 'yes',
      maxContacts: aor?.attrs['max_contacts']?.[0] ?? '1',
      callerid:    ep?.attrs['callerid']?.[0]    ?? '',
      username:    auth?.attrs['username']?.[0]  ?? id,
    },
  });
});

// ── PUT /api/asterisk/endpoints/[id] — update ─────────────────────────────────
export const PUT = withUser(async (req: NextRequest, _user: JwtPayload, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const body = await req.json() as {
    displayName?: string;
    password?: string;
    transport?: string;
    codecs?: string[];
    maxContacts?: number;
    dtmfMode?: string;
    directMedia?: boolean;
  };

  const sections = await readPjsipSections();
  const old = sections.filter((s) => s.id === id);
  const oldEp    = old.find(s => s.type === 'endpoint');
  const oldAuth  = old.find(s => s.type === 'auth');
  const oldAor   = old.find(s => s.type === 'aor');

  if (!oldEp) return NextResponse.json({ error: `Endpoint '${id}' not found in config` }, { status: 404 });

  const codecs      = body.codecs      ?? (oldEp.attrs['allow']?.[0] ?? 'ulaw,alaw').split(',');
  const transport   = body.transport   ?? oldEp.attrs['transport']?.[0]  ?? 'transport-udp';
  const dtmfMode    = body.dtmfMode    ?? oldEp.attrs['dtmf_mode']?.[0]  ?? 'rfc4733';
  const directMedia = body.directMedia ?? (oldEp.attrs['direct_media']?.[0] === 'yes');
  const maxContacts = String(body.maxContacts ?? oldAor?.attrs['max_contacts']?.[0] ?? '1');
  const callerid    = body.displayName
    ? `"${body.displayName}" <${id}>`
    : oldEp.attrs['callerid']?.[0] ?? `"${id}" <${id}>`;

  const resolvedPassword = body.password?.length ? body.password : oldAuth?.attrs['password']?.[0];

  await upsertPjsipEndpoint({
    extension: id,
    displayName: body.displayName ?? callerid.replace(/^"|" <.*$/g, ''),
    transport,
    codecs,
    maxContacts: Number(maxContacts),
    dtmfMode,
    directMedia,
    ...(resolvedPassword ? { password: resolvedPassword } : {}),
  });
  return NextResponse.json({ ok: true });
});

// ── DELETE /api/asterisk/endpoints/[id] ──────────────────────────────────────
export const DELETE = withUser(async (_req: NextRequest, _user: JwtPayload, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const deleted = await deletePjsipEndpoint(id);
  if (!deleted) return NextResponse.json({ error: 'Endpoint not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
});
