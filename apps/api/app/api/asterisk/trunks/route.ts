import { NextResponse, type NextRequest } from 'next/server';
import { type ConfSection, upsertPjsipSections } from '@/lib/asterisk/pjsip-endpoints';
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
  const authId = `auth-${id}`;
  const regId = `reg-${id}`;
  const identifyId = `identify-${id}`;

  try {
    const sections: ConfSection[] = [];

    // Auth (needed for registration trunks)
    if (username && password) {
      sections.push({
        id: authId,
        type: 'auth',
        attrs: {
          auth_type: ['userpass'],
          username: [username],
          password: [password],
          realm: [fromDomain ?? host],
        },
      });
    }

    // AOR pointing at the provider
    sections.push({
      id,
      type: 'aor',
      attrs: {
        contact: [`sip:${host}:${port}`],
        qualify_frequency: [qualify ? '30' : '0'],
      },
    });

    // Endpoint
    const endpointAttrs: Record<string, string[]> = {
      transport: [transport],
      aors: [id],
      context: [context],
      disallow: ['all'],
      allow: [codecs.join(',')],
      dtmf_mode: ['rfc4733'],
      direct_media: ['no'],
      rtp_symmetric: ['yes'],
      force_rport: ['yes'],
      rewrite_contact: ['yes'],
      from_user: [fromUser ?? username ?? ''],
      from_domain: [fromDomain ?? host],
      send_rpid: ['yes'],
    };
    if (username) endpointAttrs['outbound_auth'] = [authId];
    if (outboundProxy) endpointAttrs['outbound_proxy'] = [`sip:${outboundProxy}`];
    if (maxChannels) endpointAttrs['max_audio_streams'] = [String(maxChannels)];
    sections.push({
      id,
      type: 'endpoint',
      attrs: endpointAttrs,
    });

    // Registration (outbound registration with provider)
    if (type === 'registration' && username && password) {
      sections.push({
        id: regId,
        type: 'registration',
        attrs: {
          transport: [transport],
          outbound_auth: [authId],
          server_uri: [`sip:${host}:${port}`],
          client_uri: [`sip:${username}@${host}`],
          contact_user: [username],
          retry_interval: ['60'],
          expiration: ['3600'],
        },
      });
    }

    if (type === 'ip_auth') {
      sections.push({
        id: identifyId,
        type: 'identify',
        attrs: {
          endpoint: [id],
          match: [host],
        },
      });
    }

    await upsertPjsipSections(sections);

    return NextResponse.json({ ok: true, id });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 502 });
  }
});
