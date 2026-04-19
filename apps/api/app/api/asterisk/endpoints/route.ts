import { NextResponse, type NextRequest } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getAmiClient } from '@/lib/asterisk/ami-client';
import { ariGet } from '@/lib/asterisk/ari-client';
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

const CONF_DIR        = process.env.ASTERISK_CONF_DIR ?? '/etc/asterisk';
const ENDPOINTS_FILE  = path.join(CONF_DIR, 'pjsip_endpoints.conf');
const PJSIP_CONF_FILE = path.join(CONF_DIR, 'pjsip.conf');

// ── Config parser ─────────────────────────────────────────────────────────────

interface ConfSection {
  id:    string;
  type:  string;
  attrs: Record<string, string[]>;
}

function parseConf(content: string): ConfSection[] {
  const sections: ConfSection[] = [];
  let current: ConfSection | null = null;

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';')) continue;

    const sectionMatch = /^\[([^\]]+)\]/.exec(line);
    if (sectionMatch?.[1]) {
      if (current) sections.push(current);
      current = { id: sectionMatch[1], type: '', attrs: {} };
      continue;
    }
    if (!current) continue;
    const kv = /^([^=]+)=(.*)$/.exec(line);
    if (!kv) continue;
    const key = (kv[1] ?? '').trim();
    const val = (kv[2] ?? '').trim();
    if (!key) continue;
    if (key === 'type') { current.type = val; }
    else { (current.attrs[key] ??= []).push(val); }
  }
  if (current) sections.push(current);
  return sections;
}

function renderSection(s: ConfSection): string {
  const lines = [`[${s.id}]`, `type=${s.type}`];
  for (const [k, vals] of Object.entries(s.attrs)) {
    for (const v of vals) lines.push(`${k}=${v}`);
  }
  return lines.join('\n');
}

function renderConf(sections: ConfSection[]): string {
  const header = [
    '; ============================================================',
    '; DialerOS — PJSIP Endpoints',
    '; Auto-managed. Do not edit manually.',
    `; Last updated: ${new Date().toISOString()}`,
    '; ============================================================',
    '',
  ].join('\n');
  return header + sections.map(renderSection).join('\n\n') + '\n';
}

// ── File helpers ─────────────────────────────────────────────────────────────

async function readEndpoints(): Promise<ConfSection[]> {
  try {
    const content = await fs.readFile(ENDPOINTS_FILE, 'utf-8');
    return parseConf(content);
  } catch {
    return [];
  }
}

async function writeEndpoints(sections: ConfSection[]): Promise<void> {
  await fs.writeFile(ENDPOINTS_FILE, renderConf(sections), 'utf-8');

  // Ensure pjsip.conf includes it
  let pjsip = '';
  try { pjsip = await fs.readFile(PJSIP_CONF_FILE, 'utf-8'); } catch { /* file missing — skip */ }
  if (!pjsip.includes('pjsip_endpoints.conf')) {
    await fs.appendFile(PJSIP_CONF_FILE, '\n#include "pjsip_endpoints.conf"\n', 'utf-8');
  }
}

async function reloadPjsip(): Promise<void> {
  try {
    const ami = await getAmiClient();
    await ami.command('module reload res_pjsip.so');
  } catch { /* non-fatal — config is saved even if reload fails */ }
}

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
    password = crypto.randomBytes(12).toString('hex'),
    transport = 'transport-udp',
    codecs = ['ulaw', 'alaw', 'g722'],
    maxContacts = 1,
    dtmfMode = 'rfc4733',
    directMedia = false,
  } = body;

  if (!extension) {
    return NextResponse.json({ ok: false, error: 'extension is required' }, { status: 400 });
  }

  const id = extension.replace(/[^a-z0-9_-]/gi, '');

  // Build the three sections: auth, aor, endpoint
  const authSection: ConfSection = {
    id, type: 'auth',
    attrs: {
      auth_type: ['userpass'],
      username:  [id],
      password:  [password],
    },
  };

  const aorSection: ConfSection = {
    id, type: 'aor',
    attrs: {
      max_contacts:      [String(maxContacts)],
      remove_existing:   ['yes'],
      qualify_frequency: ['30'],
      qualify_timeout:   ['3.0'],
    },
  };

  const endpointSection: ConfSection = {
    id, type: 'endpoint',
    attrs: {
      transport:             [transport],
      auth:                  [id],
      aors:                  [id],
      callerid:              [`"${displayName}" <${id}>`],
      context:               ['agents'],
      disallow:              ['all'],      // disallow must come before allow
      allow:                 [codecs.join(',')],
      dtmf_mode:             [dtmfMode],
      direct_media:          [directMedia ? 'yes' : 'no'],
      rtp_symmetric:         ['yes'],
      force_rport:           ['yes'],
      rewrite_contact:       ['yes'],
      send_rpid:             ['yes'],
      trust_id_inbound:      ['yes'],
      device_state_busy_at:  [String(maxContacts)],
    },
  };

  try {
    // Read existing, remove old sections for this ID, append new ones
    const existing = await readEndpoints();
    const filtered = existing.filter(s => s.id !== id);
    await writeEndpoints([...filtered, authSection, aorSection, endpointSection]);
    await reloadPjsip();

    return NextResponse.json({ ok: true, extension: id, password });
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
    const existing = await readEndpoints();
    const filtered = existing.filter(s => s.id !== id);
    await writeEndpoints(filtered);
    await reloadPjsip();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
});
