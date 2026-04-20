import { NextResponse, type NextRequest } from 'next/server';
import { ariGet } from '@/lib/asterisk/ari-client';
import { deletePjsipEndpoint, upsertPjsipEndpoint } from '@/lib/asterisk/pjsip-endpoints';
import { withUser } from '@/lib/auth/rbac';
import type { JwtPayload } from '@/lib/auth/jwt';

/**
 * PJSIP Endpoints — File-based management
 *
 * The ARI dynamic config API (/asterisk/config/dynamic/...) only works with
 * memory or realtime sorcery backends. Since PJSIP defaults to file-based
 * sorcery, we write directly to pjsip_endpoints.conf (which is bind-mounted
 * from the host into this container) and reload PJSIP via AMI.
 *
 * Prerequisites (run once on server):
 *   echo '#include "pjsip_endpoints.conf"' >> /etc/asterisk/pjsip.conf
 *   touch /etc/asterisk/pjsip_endpoints.conf
 *   chown asterisk:asterisk /etc/asterisk/pjsip_endpoints.conf
 *   asterisk -rx "module reload res_pjsip.so"
 */

// ── GET /api/asterisk/endpoints ───────────────────────────────────────────────

export const GET = withUser(async (_req: NextRequest, _user: JwtPayload) => {
  try {
    const endpoints = await ariGet<Array<{ id: string; state: string; channel_ids: string[] }>>('/endpoints/PJSIP');
    return NextResponse.json({ data: endpoints });
  } catch (err) {
    const msg = String(err);
    // Asterisk returns 404 when no PJSIP endpoints are configured yet
    if (msg.includes('404') || msg.includes('No Endpoints found')) {
      return NextResponse.json({ data: [] });
    }
    return NextResponse.json({ error: msg }, { status: 502 });
  }
});

// ── POST /api/asterisk/endpoints — create/update ──────────────────────────────

export const POST = withUser(async (req: NextRequest, _user: JwtPayload) => {
  const body = await req.json() as {
    extension: string;
    displayName: string;
    password?: string;
    transport?: string;
    codecs?: string[];
    maxContacts?: number;
    dtmfMode?: string;
    directMedia?: boolean;
  };

  const {
    extension,
    displayName,
    password,
    transport = 'transport-udp',
    codecs = ['ulaw', 'alaw', 'g722'],
    maxContacts = 1,
    dtmfMode = 'rfc4733',
    directMedia = false,
  } = body;

  if (!extension) {
    return NextResponse.json({ ok: false, error: 'extension is required' }, { status: 400 });
  }

  try {
    const created = await upsertPjsipEndpoint({
      extension,
      displayName,
      transport,
      codecs,
      maxContacts,
      dtmfMode,
      directMedia,
      ...(password ? { password } : {}),
    });
    return NextResponse.json({ ok: true, extension: created.extension, password: created.password });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err) },
      { status: 500 },
    );
  }
});

// ── DELETE /api/asterisk/endpoints/[id] is handled via [id]/route.ts
// DELETE here is a convenience for direct extension deletion
export const DELETE = withUser(async (req: NextRequest, _user: JwtPayload) => {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ ok: false, error: 'id query param required' }, { status: 400 });

  try {
    await deletePjsipEndpoint(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
});
