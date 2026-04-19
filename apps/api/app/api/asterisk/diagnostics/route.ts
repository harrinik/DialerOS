import { NextResponse } from 'next/server';
import { createConnection } from 'net';
import { withUser } from '@/lib/auth/rbac';
import { connectDb } from '@/lib/db/connection';
import { AsteriskSettings } from '@/lib/db/models/AsteriskSettings';

export interface DiagStep {
  step: number;
  label: string;
  status: 'ok' | 'fail' | 'warn' | 'skip';
  detail: string;
  hint?: string;
  durationMs?: number;
}

export interface DiagReport {
  timestamp: string;
  overallOk: boolean;
  ari: DiagStep[];
  ami: DiagStep[];
}

function timer() {
  const start = Date.now();
  return () => Date.now() - start;
}

async function tcpProbe(host: string, port: number, timeoutMs = 5000): Promise<{ ok: boolean; durationMs: number; error?: string }> {
  const elapsed = timer();
  return new Promise(resolve => {
    const sock = createConnection({ host, port });
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => {
      const ms = elapsed();
      sock.destroy();
      resolve({ ok: true, durationMs: ms });
    });
    sock.once('timeout', () => {
      sock.destroy();
      resolve({ ok: false, durationMs: elapsed(), error: `No response within ${timeoutMs}ms — port may be firewalled (DROP)` });
    });
    sock.once('error', (err) => {
      resolve({ ok: false, durationMs: elapsed(), error: err.message });
    });
  });
}

async function ariDiag(s: { ariHost: string; ariPort: number; ariUser: string; ariPassword: string; ariProtocol?: string }): Promise<DiagStep[]> {
  const steps: DiagStep[] = [];
  const protocol = s.ariProtocol === 'https' ? 'https' : 'http';
  const host = s.ariHost || 'host.docker.internal';
  const port = s.ariPort || 8088;
  const baseUrl = `${protocol}://${host}:${port}`;

  // Step 1: TCP probe
  const tcp = await tcpProbe(host, port, 5000);
  steps.push({
    step: 1, label: 'TCP Connection',
    status: tcp.ok ? 'ok' : 'fail',
    detail: tcp.ok
      ? `Connected to ${host}:${port} in ${tcp.durationMs}ms`
      : `Cannot reach ${host}:${port} — ${tcp.error}`,
    hint: tcp.ok ? undefined : [
      `• Is Asterisk running? Run: systemctl status asterisk`,
      `• Is ARI HTTP enabled? Check /etc/asterisk/http.conf → bindaddr=0.0.0.0 and bindport=${port}`,
      `• Firewall: ufw allow ${port}/tcp`,
    ].join('\n'),
    durationMs: tcp.durationMs,
  });
  if (!tcp.ok) return steps;

  // Step 2: HTTP response
  const elapsed2 = timer();
  let httpStatus = 0;
  try {
    const r = await fetch(`${baseUrl}/ari/asterisk/info`, {
      headers: { Authorization: `Basic ${Buffer.from(`${s.ariUser}:${s.ariPassword}`).toString('base64')}` },
      signal: AbortSignal.timeout(8000),
    });
    httpStatus = r.status;
    const ms2 = elapsed2();

    if (r.status === 401) {
      steps.push({
        step: 2, label: 'ARI Authentication',
        status: 'fail',
        detail: `HTTP 401 Unauthorized — credentials rejected by Asterisk`,
        hint: [
          `• ARI user '${s.ariUser}' password in Connection Hub does not match /etc/asterisk/ari.conf`,
          `• Verify: grep -A3 '[${s.ariUser}]' /etc/asterisk/ari.conf`,
          `• Current ARI user configured: '${s.ariUser}'`,
        ].join('\n'),
        durationMs: ms2,
      });
      return steps;
    }

    if (r.status === 403) {
      steps.push({
        step: 2, label: 'ARI Authentication',
        status: 'fail',
        detail: `HTTP 403 Forbidden — check ARI app name or allowed_origins`,
        hint: `• In /etc/asterisk/ari.conf: set allowed_origins = *`,
        durationMs: ms2,
      });
      return steps;
    }

    if (!r.ok) {
      steps.push({
        step: 2, label: 'ARI HTTP Response',
        status: 'fail',
        detail: `HTTP ${r.status} from ${baseUrl}/ari/asterisk/info`,
        hint: `• Asterisk may not have loaded the ARI module. Run: asterisk -rx "module show like res_ari"`,
        durationMs: ms2,
      });
      return steps;
    }

    const info = await r.json() as { build?: { version?: string }; status?: { startup_time?: string } };
    steps.push({
      step: 2, label: 'ARI Authentication',
      status: 'ok',
      detail: `Authenticated successfully. Asterisk ${info?.build?.version ?? 'unknown'} — up since ${info?.status?.startup_time ?? 'unknown'}`,
      durationMs: ms2,
    });

    // Step 3: App registration
    const elapsed3 = timer();
    try {
      const appsR = await fetch(`${baseUrl}/ari/applications`, {
        headers: { Authorization: `Basic ${Buffer.from(`${s.ariUser}:${s.ariPassword}`).toString('base64')}` },
        signal: AbortSignal.timeout(5000),
      });
      const apps = await appsR.json() as Array<{ name: string }>;
      const ms3 = elapsed3();
      const dialerApp = Array.isArray(apps) ? apps.find(a => a.name === 'dialer') : null;
      steps.push({
        step: 3, label: 'Stasis App "dialer"',
        status: dialerApp ? 'ok' : 'warn',
        detail: dialerApp
          ? `Application 'dialer' is registered with Asterisk`
          : `Application 'dialer' not yet registered — ${Array.isArray(apps) ? apps.length : 0} other apps found`,
        hint: dialerApp ? undefined : [
          `• The worker service must be running and connected for the Stasis app to register`,
          `• Check: docker compose ps worker`,
          `• Check worker logs: docker compose logs worker --tail=30`,
        ].join('\n'),
        durationMs: ms3,
      });
    } catch {
      steps.push({ step: 3, label: 'Stasis App "dialer"', status: 'warn', detail: 'Could not check app registration', durationMs: elapsed3() });
    }
  } catch (err) {
    steps.push({
      step: 2, label: 'ARI HTTP Response',
      status: 'fail',
      detail: `HTTP fetch failed: ${String(err)}`,
      hint: `HTTP ${httpStatus} — check Asterisk HTTP server in /etc/asterisk/http.conf`,
    });
  }

  return steps;
}

async function amiDiag(s: { amiHost?: string; amiPort?: number; amiUser?: string; amiPassword?: string; ariHost: string; ariPassword: string }): Promise<DiagStep[]> {
  const steps: DiagStep[] = [];
  const host = s.amiHost || s.ariHost || 'host.docker.internal';
  const port = s.amiPort || 5038;
  const user = s.amiUser || 'dialer';
  const pass = s.amiPassword || s.ariPassword;

  // Step 1: TCP probe
  const tcp = await tcpProbe(host, port, 5000);
  steps.push({
    step: 1, label: 'TCP Connection',
    status: tcp.ok ? 'ok' : 'fail',
    detail: tcp.ok
      ? `Connected to ${host}:${port} (${host === 'host.docker.internal' ? 'Docker → host' : 'direct'}) in ${tcp.durationMs}ms`
      : `Cannot reach ${host}:${port} — ${tcp.error}`,
    hint: tcp.ok ? undefined : [
      `• Is Asterisk running? Run: systemctl status asterisk`,
      `• Is AMI enabled? Check /etc/asterisk/manager.conf → enabled=yes and bindaddr=0.0.0.0`,
      `• Firewall: ufw allow from 172.16.0.0/12 to any port ${port}`,
      `• Test directly: nc -zv ${host} ${port}`,
    ].join('\n'),
    durationMs: tcp.durationMs,
  });
  if (!tcp.ok) return steps;

  // Step 2: Banner + Auth
  const elapsed2 = timer();
  await new Promise<void>((resolve) => {
    let buffer = '';
    let bannerReceived = false;
    let authSent = false;
    let done = false;

    const finish = (step: DiagStep) => {
      if (done) return;
      done = true;
      steps.push(step);
      sock.destroy();
      resolve();
    };

    const sock = createConnection({ host, port });
    sock.setTimeout(8000);

    sock.on('timeout', () => {
      if (!bannerReceived) {
        finish({
          step: 2, label: 'AMI Banner',
          status: 'fail',
          detail: `TCP connected but Asterisk sent no banner within 8s — AMI may not be accepting connections from this IP`,
          hint: [
            `• Check manager.conf permit list includes Docker network (172.16.0.0/12)`,
            `• Current connection source IP is a Docker container IP (~172.17.x.x or 172.18.x.x)`,
            `• grep -A10 '[general]' /etc/asterisk/manager.conf`,
            `• Reload AMI: asterisk -rx "manager reload"`,
          ].join('\n'),
          durationMs: elapsed2(),
        });
      } else {
        finish({
          step: 3, label: 'AMI Authentication',
          status: 'fail',
          detail: `Banner received but no auth response within 8s`,
          hint: `• Check Asterisk logs: journalctl -u asterisk -n 30`,
          durationMs: elapsed2(),
        });
      }
    });

    sock.on('error', (err) => {
      finish({
        step: bannerReceived ? 3 : 2,
        label: bannerReceived ? 'AMI Authentication' : 'AMI Banner',
        status: 'fail',
        detail: `Socket error: ${err.message}`,
        durationMs: elapsed2(),
      });
    });

    sock.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();

      if (!bannerReceived && buffer.includes('Asterisk Call Manager')) {
        bannerReceived = true;
        const bannerLine = buffer.match(/Asterisk Call Manager\/([^\r\n]+)/)?.[1] ?? 'unknown';
        steps.push({
          step: 2, label: 'AMI Banner',
          status: 'ok',
          detail: `Received banner: Asterisk Call Manager/${bannerLine}`,
          durationMs: elapsed2(),
        });

        if (!authSent) {
          authSent = true;
          const id = `diag_${Date.now()}`;
          sock.write(`Action: Login\r\nUsername: ${user}\r\nSecret: ${pass}\r\nActionID: ${id}\r\n\r\n`);
        }
      }

      if (bannerReceived && buffer.includes('\r\n\r\n')) {
        const packets = buffer.split('\r\n\r\n');
        for (const packet of packets) {
          if (!packet.trim()) continue;
          const lines = packet.split('\r\n');
          const obj: Record<string, string> = {};
          for (const line of lines) {
            const idx = line.indexOf(':');
            if (idx > 0) obj[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
          }
          if (obj['Response']) {
            if (obj['Response'] === 'Success') {
              // Step 3: Logged in — now ping
              const pingId = `ping_${Date.now()}`;
              sock.write(`Action: Ping\r\nActionID: ${pingId}\r\n\r\n`);
              const pingStart = Date.now();
              const pingTimeout = setTimeout(() => {
                finish({
                  step: 3, label: 'AMI Authentication + Ping',
                  status: 'warn',
                  detail: `Logged in as '${user}' but Ping timed out`,
                  durationMs: elapsed2(),
                });
              }, 3000);
              // Wait for Ping response
              const pingListener = (pingChunk: Buffer) => {
                const pingBuf = pingChunk.toString();
                if (pingBuf.includes('Ping') && pingBuf.includes('Response: Success')) {
                  clearTimeout(pingTimeout);
                  sock.removeListener('data', pingListener);
                  finish({
                    step: 3, label: 'AMI Authentication + Ping',
                    status: 'ok',
                    detail: `Logged in as '${user}'. Ping RTT: ${Date.now() - pingStart}ms`,
                    durationMs: elapsed2(),
                  });
                }
              };
              sock.on('data', pingListener);
            } else {
              finish({
                step: 3, label: 'AMI Authentication',
                status: 'fail',
                detail: `Auth rejected: ${obj['Message'] ?? 'unknown reason'} (user: '${user}')`,
                hint: [
                  `• Wrong password for AMI user '${user}' in MongoDB Connection Hub`,
                  `• Correct password is in /etc/asterisk/manager.conf`,
                  `• Check: grep -A5 '[${user}]' /etc/asterisk/manager.conf`,
                  `• Update password in Asterisk → Connection Hub → AMI Password`,
                ].join('\n'),
                durationMs: elapsed2(),
              });
            }
            break;
          }
        }
      }
    });
  });

  return steps;
}

// POST /api/asterisk/diagnostics — run full step-by-step diagnostic
export const POST = withUser(async () => {
  await connectDb();
  const raw = await AsteriskSettings.findOne({}).lean() as Record<string, unknown> | null;
  if (!raw) {
    return NextResponse.json({
      timestamp: new Date().toISOString(),
      overallOk: false,
      error: 'No Asterisk settings configured. Go to Connection Hub and save your settings first.',
      ari: [], ami: [],
    });
  }

  const s = {
    ariHost:     (raw.ariHost as string)     || 'host.docker.internal',
    ariPort:     (raw.ariPort as number)     || 8088,
    ariUser:     (raw.ariUser as string)     || 'dialer',
    ariPassword: (raw.ariPassword as string) || '',
    ariProtocol: (raw.ariProtocol as string) || 'http',
    amiHost:     (raw.amiHost as string)     || '',
    amiPort:     (raw.amiPort as number)     || 5038,
    amiUser:     (raw.amiUser as string)     || '',
    amiPassword: (raw.amiPassword as string) || '',
  };

  const [ariSteps, amiSteps] = await Promise.all([
    ariDiag(s),
    amiDiag(s),
  ]);

  const ariOk = ariSteps.every(s => s.status === 'ok' || s.status === 'warn');
  const amiOk = amiSteps.every(s => s.status === 'ok' || s.status === 'warn');

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    overallOk: ariOk && amiOk,
    ari: ariSteps,
    ami: amiSteps,
  } satisfies DiagReport);
});

// GET /api/asterisk/diagnostics — quick status ping (used by logs page on load)
export const GET = withUser(async () => {
  await connectDb();
  const raw = await AsteriskSettings.findOne({}).lean() as Record<string, unknown> | null;
  if (!raw) return NextResponse.json({ configured: false });

  const host = (raw.ariHost as string) || 'host.docker.internal';
  const port = (raw.ariPort as number) || 8088;

  try {
    const r = await fetch(`http://${host}:${port}/ari/asterisk/info`, {
      headers: { Authorization: `Basic ${Buffer.from(`${raw.ariUser}:${raw.ariPassword}`).toString('base64')}` },
      signal: AbortSignal.timeout(4000),
    });
    if (!r.ok) return NextResponse.json({ configured: true, ariOk: false, ariStatus: r.status });
    const info = await r.json() as { build?: { version?: string }; status?: { startup_time?: string } };
    return NextResponse.json({ configured: true, ariOk: true, version: info.build?.version, upSince: info.status?.startup_time });
  } catch {
    return NextResponse.json({ configured: true, ariOk: false });
  }
});
