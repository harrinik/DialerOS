import { NextResponse, type NextRequest } from 'next/server';
import { pjsipPut } from '@/lib/asterisk/ari-client';
import { withUser } from '@/lib/auth/rbac';
import type { JwtPayload } from '@/lib/auth/jwt';

interface TrunkBody {
  name: string;
  host: string;
  port?: number;
  username?: string;
  password?: string;
  fromUser?: string;
  fromDomain?: string;
  transport?: string;
  codecs?: string[];
  context?: string;
  maxChannels?: number;
  type?: 'registration' | 'ip_auth';
  outboundProxy?: string;
  qualify?: boolean;
}

/**
 * GET  /api/asterisk/trunks  — list all trunk-prefixed PJSIP endpoints
 * POST /api/asterisk/trunks  — create a SIP trunk
 */
export const GET = withUser(async (_req: NextRequest, _user: JwtPayload) => {
  try {
    const { ariGet } = await import('@/lib/asterisk/ari-client');
    const all = await ariGet<Array<{ technology: string; resource: string; state: string; channel_ids: string[] }>>('/endpoints/PJSIP');
    // Trunks are identified by the 'trunk-' prefix on the resource name
    const trunks = all
      .filter((e) => (e.resource ?? '').startsWith('trunk-'))
      .map((e) => ({ id: e.resource, state: e.state, channel_ids: e.channel_ids }));
    return NextResponse.json({ data: trunks });
  } catch (err) {
    const msg = String(err);
    // ARI returns 404 when no PJSIP endpoints exist at all
    if (msg.includes('404') || msg.includes('No Endpoints found')) {
      return NextResponse.json({ data: [] });
    }
    return NextResponse.json({ error: msg }, { status: 502 });
  }
});

export const POST = withUser(async (req: NextRequest, _user: JwtPayload) => {
  const body = await req.json() as TrunkBody;
  const {
    name, host, port = 5060, username, password,
    fromUser, fromDomain, transport = 'transport-udp',
    codecs = ['ulaw', 'alaw'], context = 'from-trunk',
    maxChannels = 30, type = 'registration',
    outboundProxy, qualify = true,
  } = body;

  const id = `trunk-${name.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;

  try {
    // Auth (needed for registration trunks)
    if (username && password) {
      await pjsipPut('res_pjsip', 'auth', `auth-${id}`, [
        { attribute: 'auth_type', value: 'userpass' },
        { attribute: 'username',  value: username },
        { attribute: 'password',  value: password },
        { attribute: 'realm',     value: fromDomain ?? host },
      ]);
    }

    // AOR pointing at the provider
    await pjsipPut('res_pjsip', 'aor', id, [
      { attribute: 'contact',          value: `sip:${host}:${port}` },
      { attribute: 'qualify_frequency',value: qualify ? '30' : '0' },
    ]);

    // Endpoint
    const epFields: Array<{ attribute: string; value: string }> = [
      { attribute: 'transport',    value: transport },
      { attribute: 'aors',         value: id },
      { attribute: 'context',      value: context },
      { attribute: 'disallow',     value: 'all' },
      { attribute: 'allow',        value: codecs.join(',') },
      { attribute: 'dtmf_mode',    value: 'rfc4733' },
      { attribute: 'direct_media', value: 'no' },
      { attribute: 'rtp_symmetric', value: 'yes' },
      { attribute: 'force_rport',  value: 'yes' },
      { attribute: 'rewrite_contact', value: 'yes' },
      { attribute: 'from_user',    value: fromUser ?? username ?? '' },
      { attribute: 'from_domain',  value: fromDomain ?? host },
      { attribute: 'send_rpid',    value: 'yes' },
    ];
    if (username) epFields.push({ attribute: 'outbound_auth', value: `auth-${id}` });
    if (outboundProxy) epFields.push({ attribute: 'outbound_proxy', value: `sip:${outboundProxy}` });
    if (maxChannels) epFields.push({ attribute: 'max_audio_streams', value: String(maxChannels) });
    await pjsipPut('res_pjsip', 'endpoint', id, epFields);

    // Registration (outbound registration with provider)
    if (type === 'registration' && username && password) {
      await pjsipPut('res_pjsip', 'registration', `reg-${id}`, [
        { attribute: 'transport',   value: transport },
        { attribute: 'outbound_auth', value: `auth-${id}` },
        { attribute: 'server_uri',  value: `sip:${host}:${port}` },
        { attribute: 'client_uri',  value: `sip:${username}@${host}` },
        { attribute: 'contact_user',value: username },
        { attribute: 'retry_interval', value: '60' },
        { attribute: 'expiration',  value: '3600' },
      ]);
    }

    return NextResponse.json({ ok: true, id });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 502 });
  }
});
