import { NextResponse, type NextRequest } from 'next/server';
import { ariGet, pjsipPut } from '@/lib/asterisk/ari-client';
import { withUser } from '@/lib/auth/rbac';
import type { JwtPayload } from '@/lib/auth/jwt';
import crypto from 'crypto';

/**
 * GET  /api/asterisk/endpoints  — list all PJSIP endpoints + status
 * POST /api/asterisk/endpoints  — create endpoint + auth + aor
 */
export const GET = withUser(async (_req: NextRequest, _user: JwtPayload) => {
  try {
    const endpoints = await ariGet<Array<{ id: string; state: string; channel_ids: string[] }>>('/endpoints/PJSIP');
    return NextResponse.json({ data: endpoints });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
});

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
    // Auto-generate a password if none supplied
    password = crypto.randomBytes(12).toString('hex'),
    transport = 'transport-udp',
    codecs = ['ulaw', 'alaw', 'g722'],
    maxContacts = 1,
    dtmfMode = 'rfc4733',
    directMedia = false,
  } = body;

  if (!extension) return NextResponse.json({ ok: false, error: 'extension is required' }, { status: 400 });

  const id = extension.replace(/[^a-z0-9_-]/gi, '');

  try {
    // 1. Auth object
    await pjsipPut('res_pjsip', 'auth', id, [
      { attribute: 'auth_type', value: 'userpass' },
      { attribute: 'username',  value: id },
      { attribute: 'password',  value: password },
    ]);

    // 2. AOR (Address of Record)
    await pjsipPut('res_pjsip', 'aor', id, [
      { attribute: 'max_contacts',       value: String(maxContacts) },
      { attribute: 'remove_existing',    value: 'yes' },
      { attribute: 'qualify_frequency',  value: '30' },
      { attribute: 'qualify_timeout',    value: '3.0' },
    ]);

    // 3. Endpoint — NOTE: disallow must come before allow in PJSIP
    await pjsipPut('res_pjsip', 'endpoint', id, [
      { attribute: 'transport',          value: transport },
      { attribute: 'auth',               value: id },
      { attribute: 'aors',               value: id },
      { attribute: 'callerid',           value: `"${displayName}" <${id}>` },
      { attribute: 'context',            value: 'agents' },
      { attribute: 'disallow',           value: 'all' },          // must be before allow
      { attribute: 'allow',              value: codecs.join(',') },
      { attribute: 'dtmf_mode',          value: dtmfMode },
      { attribute: 'direct_media',       value: directMedia ? 'yes' : 'no' },
      { attribute: 'rtp_symmetric',      value: 'yes' },
      { attribute: 'force_rport',        value: 'yes' },
      { attribute: 'rewrite_contact',    value: 'yes' },
      { attribute: 'send_rpid',          value: 'yes' },
      { attribute: 'trust_id_inbound',   value: 'yes' },
      { attribute: 'device_state_busy_at', value: String(maxContacts) },
    ]);

    return NextResponse.json({ ok: true, extension: id, password });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 502 });
  }
});
