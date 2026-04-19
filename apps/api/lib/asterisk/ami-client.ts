/**
 * AMI (Asterisk Manager Interface) TCP Client
 *
 * Maintains a persistent TCP connection to Asterisk AMI.
 * Thread-safe via action ID sequencing and Promise resolution.
 */
import { createConnection, type Socket } from 'net';
import { EventEmitter } from 'events';
import { connectDb } from '@/lib/db/connection';
import { AsteriskSettings } from '@/lib/db/models/AsteriskSettings';

export interface AmiResponse {
  Response?: string;
  Event?: string;
  ActionID?: string;
  Message?: string;
  Output?: string;
  [key: string]: string | undefined;
}

class AmiClient extends EventEmitter {
  private socket: Socket | null = null;
  private buffer = '';
  private pending = new Map<string, { resolve: (r: AmiResponse) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  private seq = 0;
  public connected = false;
  public loggedIn = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private config: { host: string; port: number; user: string; pass: string } | null = null;

  configure(cfg: { host: string; port: number; user: string; pass: string }) {
    this.config = cfg;
  }

  async connect(timeoutMs = 10_000): Promise<void> {
    if (!this.config) throw new Error('AMI not configured');

    // Destroy any stale socket before creating a new one
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }

    return new Promise((resolve, reject) => {
      const sock = createConnection({ host: this.config!.host, port: this.config!.port });
      this.socket = sock;

      // TCP-level connection timeout — fires if the SYN is silently dropped
      sock.setTimeout(timeoutMs);
      sock.once('timeout', () => {
        sock.destroy();
        reject(new Error(`AMI TCP connect timed out after ${timeoutMs}ms — check host, port, and firewall`));
      });

      const onError = (err: Error) => {
        this.connected = false;
        reject(err);
      };

      sock.once('error', onError);
      sock.on('data', (chunk: Buffer) => this.handleData(chunk.toString()));
      sock.on('close', () => {
        this.connected = false;
        this.loggedIn = false;
        this.emit('disconnected');
        this.scheduleReconnect();
      });
      sock.on('error', (err) => this.emit('error', err));

      // AMI sends a banner line first — clear timeout once connected
      this.once('_banner', async () => {
        sock.setTimeout(0);  // disable timeout after banner received
        sock.removeListener('error', onError);
        try {
          await this.login();
          this.connected = true;
          resolve();
        } catch (e) {
          reject(e instanceof Error ? e : new Error(String(e)));
        }
      });
    });
  }

  private handleData(data: string) {
    this.buffer += data;
    // AMI packets are delimited by \r\n\r\n
    const packets = this.buffer.split('\r\n\r\n');
    this.buffer = packets.pop() ?? '';

    for (const packet of packets) {
      if (!packet.trim()) continue;

      if (packet.startsWith('Asterisk Call Manager')) {
        this.emit('_banner');
        continue;
      }

      const obj: AmiResponse = {};
      const lines = packet.split('\r\n');
      for (const line of lines) {
        const idx = line.indexOf(':');
        if (idx < 0) continue;
        const key = line.slice(0, idx).trim();
        const val = line.slice(idx + 1).trim();
        // Handle Output lines which have no key
        if (key === 'Output') {
          obj['Output'] = (obj['Output'] ? obj['Output'] + '\n' : '') + val;
        } else if (key) {
          obj[key] = val;
        }
      }

      if (obj.Response) {
        const id = obj.ActionID;
        if (id && this.pending.has(id)) {
          const { resolve, timer } = this.pending.get(id)!;
          clearTimeout(timer);
          this.pending.delete(id);
          resolve(obj);
        }
      } else if (obj.Event) {
        this.emit('event', obj);
        this.emit(`event:${obj.Event}`, obj);
      }
    }
  }

  private async login(): Promise<void> {
    const resp = await this.sendAction({ Action: 'Login', Username: this.config!.user, Secret: this.config!.pass });
    if (resp.Response !== 'Success') {
      throw new Error(`AMI login failed: ${resp.Message ?? 'Auth rejected'}`);
    }
    this.loggedIn = true;
  }

  async sendAction(fields: Record<string, string>, timeoutMs = 10_000): Promise<AmiResponse> {
    if (!this.socket) throw new Error('AMI socket not connected');

    const id = `${Date.now()}_${++this.seq}`;
    fields['ActionID'] = id;

    const payload = Object.entries(fields)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\r\n') + '\r\n\r\n';

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`AMI action timed out: ${fields['Action']}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.socket!.write(payload);
    });
  }

  /** Execute a raw Asterisk CLI command via AMI — ISSUE-20: strips --END COMMAND-- terminator */
  async command(cmd: string): Promise<string> {
    const resp = await this.sendAction({ Action: 'Command', Command: cmd }, 15_000);
    const raw = resp.Output ?? resp.Message ?? '';
    // ISSUE-20: Asterisk terminates command output with '--END COMMAND--'; strip it
    return raw.replace(/--END COMMAND--\s*$/m, '').trim();
  }


  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (!this.config) return;
      try { await this.connect(); } catch { this.scheduleReconnect(); }
    }, 5000);
  }

  disconnect() {
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this.socket?.destroy();
    this.socket = null;
    this.connected = false;
    this.loggedIn = false;
  }
}

// Module-level singleton (persists across Next.js hot-reloads in dev)
declare global { var __amiClient: AmiClient | undefined; }
const client: AmiClient = global.__amiClient ?? (global.__amiClient = new AmiClient());

/**
 * Returns a connected, logged-in AMI client (lazy-connects on first call).
 * Reads credentials from MongoDB.
 */
export async function getAmiClient(): Promise<AmiClient> {
  if (client.loggedIn && client.connected) return client;

  await connectDb();
  const s = await AsteriskSettings.findOne({}).lean();
  if (!s) throw new Error('Asterisk not configured');

  client.configure({
    host: s.amiHost ?? s.ariHost,
    port: s.amiPort ?? 5038,
    user: s.amiUser ?? s.ariUser,
    pass: s.amiPassword ?? s.ariPassword,
  });

  await client.connect();
  return client;
}

export { AmiClient };
