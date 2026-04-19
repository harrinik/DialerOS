import { NextResponse, type NextRequest } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { getAmiClient } from '@/lib/asterisk/ami-client';
import { withUser } from '@/lib/auth/rbac';
import type { JwtPayload } from '@/lib/auth/jwt'

const CONF_DIR       = process.env.ASTERISK_CONF_DIR ?? '/etc/asterisk';
const ENDPOINTS_FILE = path.join(CONF_DIR, 'pjsip_endpoints.conf');

interface ConfSection { id: string; type: string; attrs: Record<string, string[]> }

function parseConf(content: string): ConfSection[] {
  const sections: ConfSection[] = [];
  let current: ConfSection | null = null;
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';')) continue;
    const m = /^\[([^\]]+)\]/.exec(line);
    if (m?.[1]) {
      if (current) sections.push(current);
      current = { id: m[1], type: '', attrs: {} };
      continue;
    }
    if (!current) continue;
    const kv = /^([^=]+)=(.*)$/.exec(line);
    if (!kv) continue;
    const key = (kv[1] ?? '').trim();
    const val = (kv[2] ?? '').trim();
    if (!key) continue;
    if (key === 'type') current.type = val;
    else (current.attrs[key] ??= []).push(val);
  }
  if (current) sections.push(current);
  return sections;
}

function renderSection(s: ConfSection): string {
  return [`[${s.id}]`, `type=${s.type}`, ...Object.entries(s.attrs).flatMap(([k, vs]) => vs.map(v => `${k}=${v}`))].join('\n');
}

function renderConf(sections: ConfSection[]): string {
  return [
    '; ============================================================',
    '; DialerOS — PJSIP Endpoints',
    '; Auto-managed by DialerOS API. Do not edit manually.',
    `; Last updated: ${new Date().toISOString()}`,
    '; ============================================================',
    '', ...sections.map(renderSection), '',
  ].join('\n');
}

async function readConf(): Promise<ConfSection[]> {
  try { return parseConf(await fs.readFile(ENDPOINTS_FILE, 'utf-8')); } catch { return []; }
}

async function reloadPjsip() {
  try { await (await getAmiClient()).command('module reload res_pjsip.so'); } catch { /* non-fatal */ }
}

// ── GET /api/asterisk/endpoints/[id] ─────────────────────────────────────────
export const GET = withUser(async (_req: NextRequest, _user: JwtPayload, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const sections = await readConf();
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

  const sections = await readConf();
  const others   = sections.filter(s => s.id !== id);
  const old      = sections.filter(s => s.id === id);
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

  const authSection: ConfSection = {
    id, type: 'auth',
    attrs: {
      auth_type: ['userpass'],
      username:  [id],
      password:  [body.password?.length ? body.password : (oldAuth?.attrs['password']?.[0] ?? '')],
    },
  };

  const aorSection: ConfSection = {
    id, type: 'aor',
    attrs: {
      max_contacts:      [maxContacts],
      remove_existing:   ['yes'],
      qualify_frequency: ['30'],
      qualify_timeout:   ['3.0'],
    },
  };

  const endpointSection: ConfSection = {
    id, type: 'endpoint',
    attrs: {
      transport: [transport], auth: [id], aors: [id],
      callerid:  [callerid],  context: ['agents'],
      disallow:  ['all'],     allow: [codecs.join(',')],
      dtmf_mode: [dtmfMode],  direct_media: [directMedia ? 'yes' : 'no'],
      rtp_symmetric: ['yes'], force_rport: ['yes'], rewrite_contact: ['yes'],
      send_rpid: ['yes'],     trust_id_inbound: ['yes'],
      device_state_busy_at: [maxContacts],
    },
  };

  await fs.writeFile(ENDPOINTS_FILE, renderConf([...others, authSection, aorSection, endpointSection]), 'utf-8');
  await reloadPjsip();
  return NextResponse.json({ ok: true });
});

// ── DELETE /api/asterisk/endpoints/[id] ──────────────────────────────────────
export const DELETE = withUser(async (_req: NextRequest, _user: JwtPayload, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const sections = await readConf();
  const filtered  = sections.filter(s => s.id !== id);
  if (filtered.length === sections.length) return NextResponse.json({ error: 'Endpoint not found' }, { status: 404 });
  await fs.writeFile(ENDPOINTS_FILE, renderConf(filtered), 'utf-8');
  await reloadPjsip();
  return NextResponse.json({ ok: true });
});
