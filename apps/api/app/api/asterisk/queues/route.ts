import { NextResponse, type NextRequest } from 'next/server';
import { getAmiClient } from '@/lib/asterisk/ami-client';
import { withUser } from '@/lib/auth/rbac';
import type { JwtPayload } from '@/lib/auth/jwt';

/**
 * GET  /api/asterisk/queues   — list queues via AMI QueueStatus
 * POST /api/asterisk/queues   — create a queue using AMI AddQueueMember + dialplan
 */

interface QueueEntry {
  name: string;
  max: number;
  strategy: string;
  calls: number;
  holdtime: number;
  talktime: number;
  completed: number;
  abandoned: number;
  servicelevel: number;
  servicelevelperf: string;
  weight: number;
}

export const GET = withUser(async (_req: NextRequest, _user: JwtPayload) => {
  try {
    const ami = await getAmiClient();
    const output = await ami.command('queue show');
    // Parse text output into structured data
    const lines = output.split('\n');
    const queues: QueueEntry[] = [];
    let current: Partial<QueueEntry> | null = null;
    for (const line of lines) {
      const queueMatch = line.match(/^(\S+)\s+has\s+(\d+)\s+calls/);
      if (queueMatch) {
        if (current?.name) queues.push(current as QueueEntry);
        const queueName = queueMatch[1];
        if (!queueName) continue;
        current = { name: queueName, calls: parseInt(queueMatch[2] ?? '0') };
        continue;
      }
      if (current) {
        const strategyMatch = line.match(/Strategy:\s+(\S+)/i);
        const strategyVal = strategyMatch?.[1];
        if (strategyVal) current.strategy = strategyVal;
        const holdMatch = line.match(/Max:\s+(\d+)/i);
        const holdVal = holdMatch?.[1];
        if (holdVal) current.max = parseInt(holdVal, 10);
      }
    }
    if (current?.name) queues.push(current as QueueEntry);
    return NextResponse.json({ data: queues, raw: output });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
});

export const POST = withUser(async (req: NextRequest, _user: JwtPayload) => {
  const body = await req.json() as {
    name: string;
    strategy?: string;
    timeout?: number;
    maxlen?: number;
    wrapuptime?: number;
    musicclass?: string;
    members?: string[];
  };
  const {
    name,
    strategy = 'rrmemory',
    timeout = 15,
    maxlen = 0,
    wrapuptime = 5,
    musicclass = 'default',
    members = [],
  } = body;

  if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) {
    return NextResponse.json({ ok: false, error: 'Invalid queue name' }, { status: 400 });
  }

  try {
    const ami = await getAmiClient();

    // ISSUE-15: Write queue config to queues.conf fragment so strategy/timeout/etc are applied.
    // QueueAdd only creates members, not queue-level parameters.
    const confDir = process.env['ASTERISK_CONF_DIR'] ?? '/etc/asterisk';
    const confPath = `${confDir}/queues_dialer_${name}.conf`;
    const confContent = [
      `[${name}]`,
      `strategy=${strategy}`,
      `timeout=${timeout}`,
      `maxlen=${maxlen}`,
      `wrapuptime=${wrapuptime}`,
      `musicclass=${musicclass}`,
      `joinempty=yes`,
      `leavewhenempty=no`,
      '',
    ].join('\n');

    let configWritten = false;
    try {
      const { promises: fs } = await import('node:fs');
      await fs.writeFile(confPath, confContent, 'utf8');
      configWritten = true;
      // Reload queues so Asterisk picks up the new config
      await ami.sendAction({ Action: 'Command', Command: 'queue reload all' });
    } catch {
      // If we can't write the file (permissions), fall back to dynamic-only creation
      // Queue will use Asterisk defaults for strategy/timeout
    }

    // Add members via AMI QueueAdd
    for (const ext of members) {
      const r = await ami.sendAction({
        Action:     'QueueAdd',
        Queue:      name,
        Interface:  `PJSIP/${ext}`,
        Penalty:    '0',
        Paused:     'false',
        MemberName: ext,
      });
      if (r.Response !== 'Success') {
        return NextResponse.json({ ok: false, error: `Failed to add member ${ext}: ${r.Message}` }, { status: 422 });
      }
    }

    return NextResponse.json({ ok: true, name, configWritten, strategy, timeout });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 502 });
  }
});

