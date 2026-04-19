/**
 * ARI HTTP Client
 * Reads settings from MongoDB on demand and executes authenticated ARI requests.
 */
import { connectDb } from '@/lib/db/connection';
import { AsteriskSettings } from '@/lib/db/models/AsteriskSettings';

interface AriConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  ssl: boolean;
}

let _cache: AriConfig | null = null;
let _cacheExpiry = 0;

async function getConfig(): Promise<AriConfig> {
  if (_cache && Date.now() < _cacheExpiry) return _cache;
  await connectDb();
  const s = await AsteriskSettings.findOne({}).lean();
  if (!s) throw new Error('Asterisk not configured. Go to Settings → Asterisk to add credentials.');
  _cache = {
    host: s.ariHost,
    port: s.ariPort,
    user: s.ariUser,
    password: s.ariPassword,
    ssl: s.ariSsl ?? false,
  };
  _cacheExpiry = Date.now() + 30_000; // 30s cache
  return _cache;
}

/** Call this after saving new settings to force a re-read */
export function invalidateAriCache() {
  _cache = null;
  _cacheExpiry = 0;
}

async function request(method: string, path: string, body?: unknown): Promise<Response> {
  const cfg = await getConfig();
  const scheme = cfg.ssl ? 'https' : 'http';
  const url = `${scheme}://${cfg.host}:${cfg.port}/ari${path}`;
  const auth = `Basic ${Buffer.from(`${cfg.user}:${cfg.password}`).toString('base64')}`;
  return fetch(url, {
    method,
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    ...(body !== undefined && { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(10_000),
  });
}

export async function ariGet<T = unknown>(path: string): Promise<T> {
  const r = await request('GET', path);
  if (!r.ok) {
    const text = await r.text().catch(() => r.statusText);
    throw new Error(`ARI GET ${path} → ${r.status}: ${text}`);
  }
  return r.json() as Promise<T>;
}

export async function ariPost<T = unknown>(path: string, body?: unknown): Promise<T | null> {
  const r = await request('POST', path, body);
  if (!r.ok) {
    const text = await r.text().catch(() => r.statusText);
    throw new Error(`ARI POST ${path} → ${r.status}: ${text}`);
  }
  return r.status === 204 ? null : (r.json() as Promise<T>);
}

export async function ariPut<T = unknown>(path: string, body?: unknown): Promise<T | null> {
  const r = await request('PUT', path, body);
  if (!r.ok) {
    const text = await r.text().catch(() => r.statusText);
    throw new Error(`ARI PUT ${path} → ${r.status}: ${text}`);
  }
  return r.status === 204 ? null : (r.json() as Promise<T>);
}

export async function ariDelete<T = unknown>(path: string): Promise<T | null> {
  const r = await request('DELETE', path);
  if (!r.ok && r.status !== 404) {
    const text = await r.text().catch(() => r.statusText);
    throw new Error(`ARI DELETE ${path} → ${r.status}: ${text}`);
  }
  return r.status === 204 ? null : (r.json() as Promise<T>).catch(() => null);
}

/** Raw proxy — returns the Response object for streaming */
export async function ariProxy(method: string, path: string, body?: unknown): Promise<Response> {
  return request(method, path, body);
}

/** PJSIP config helper: upsert an object */
export async function pjsipPut(
  configClass: string,
  objectType: string,
  id: string,
  fields: Array<{ attribute: string; value: string }>,
) {
  return ariPut(`/asterisk/config/dynamic/${configClass}/${objectType}/${encodeURIComponent(id)}`, {
    fields,
  });
}

/** PJSIP config helper: delete an object */
export async function pjsipDelete(configClass: string, objectType: string, id: string) {
  return ariDelete(`/asterisk/config/dynamic/${configClass}/${objectType}/${encodeURIComponent(id)}`);
}

/** Get ARI system info (used for ping / version check) */
export async function ariInfo() {
  return ariGet<{ build: { version: string }, status: { startup_time: string } }>('/asterisk/info');
}
