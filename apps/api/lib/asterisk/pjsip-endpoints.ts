import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getAmiClient } from './ami-client';

const CONF_DIR = process.env.ASTERISK_CONF_DIR ?? '/etc/asterisk';
const ENDPOINTS_FILE = path.join(CONF_DIR, 'pjsip_endpoints.conf');

export interface ConfSection {
  id: string;
  type: string;
  attrs: Record<string, string[]>;
}

export interface UpsertEndpointInput {
  extension: string;
  displayName: string;
  password?: string;
  transport?: string;
  codecs?: string[];
  maxContacts?: number;
  dtmfMode?: string;
  directMedia?: boolean;
}

export function sanitizeEndpointId(raw: string): string {
  return raw.replace(/[^a-z0-9_-]/gi, '');
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
    if (key === 'type') current.type = val;
    else (current.attrs[key] ??= []).push(val);
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

export async function readPjsipSections(): Promise<ConfSection[]> {
  try {
    const content = await fs.readFile(ENDPOINTS_FILE, 'utf-8');
    return parseConf(content);
  } catch {
    return [];
  }
}

async function writePjsipSections(sections: ConfSection[]): Promise<void> {
  await fs.writeFile(ENDPOINTS_FILE, renderConf(sections), 'utf-8');
}

async function reloadPjsip(): Promise<void> {
  try {
    const ami = await getAmiClient();
    await ami.command('module reload res_pjsip.so');
  } catch {
    // Non-fatal: config is persisted and can be reloaded manually later.
  }
}

export async function upsertPjsipSections(sectionsToUpsert: ConfSection[]): Promise<void> {
  const ids = new Set(
    sectionsToUpsert
      .map((section) => sanitizeEndpointId(section.id))
      .filter(Boolean),
  );
  if (ids.size === 0) {
    throw new Error('No valid PJSIP sections to upsert');
  }

  const existing = await readPjsipSections();
  const filtered = existing.filter((section) => !ids.has(section.id));
  await writePjsipSections([...filtered, ...sectionsToUpsert]);
  await reloadPjsip();
}

export async function deletePjsipSections(idsToDelete: string[]): Promise<boolean> {
  const ids = new Set(
    idsToDelete
      .map((id) => sanitizeEndpointId(id))
      .filter(Boolean),
  );
  if (ids.size === 0) return false;

  const existing = await readPjsipSections();
  const filtered = existing.filter((section) => !ids.has(section.id));
  if (filtered.length === existing.length) {
    return false;
  }

  await writePjsipSections(filtered);
  await reloadPjsip();
  return true;
}

export async function upsertPjsipEndpoint(input: UpsertEndpointInput): Promise<{ extension: string; password: string }> {
  const extension = sanitizeEndpointId(input.extension);
  if (!extension) {
    throw new Error('Invalid extension value');
  }

  const password = input.password?.trim() || crypto.randomBytes(12).toString('hex');
  const transport = input.transport ?? 'transport-udp';
  const codecs = input.codecs ?? ['ulaw', 'alaw', 'g722'];
  const maxContacts = input.maxContacts ?? 1;
  const dtmfMode = input.dtmfMode ?? 'rfc4733';
  const directMedia = input.directMedia ?? false;

  const authSection: ConfSection = {
    id: extension,
    type: 'auth',
    attrs: {
      auth_type: ['userpass'],
      username: [extension],
      password: [password],
    },
  };
  const aorSection: ConfSection = {
    id: extension,
    type: 'aor',
    attrs: {
      max_contacts: [String(maxContacts)],
      remove_existing: ['yes'],
      qualify_frequency: ['30'],
      qualify_timeout: ['3.0'],
    },
  };
  const endpointSection: ConfSection = {
    id: extension,
    type: 'endpoint',
    attrs: {
      transport: [transport],
      auth: [extension],
      aors: [extension],
      callerid: [`"${input.displayName}" <${extension}>`],
      context: ['agents'],
      disallow: ['all'],
      allow: [codecs.join(',')],
      dtmf_mode: [dtmfMode],
      direct_media: [directMedia ? 'yes' : 'no'],
      rtp_symmetric: ['yes'],
      force_rport: ['yes'],
      rewrite_contact: ['yes'],
      send_rpid: ['yes'],
      trust_id_inbound: ['yes'],
      device_state_busy_at: [String(maxContacts)],
    },
  };

  await upsertPjsipSections([authSection, aorSection, endpointSection]);

  return { extension, password };
}

export async function deletePjsipEndpoint(extension: string): Promise<boolean> {
  const id = sanitizeEndpointId(extension);
  if (!id) return false;

  return deletePjsipSections([id]);
}
