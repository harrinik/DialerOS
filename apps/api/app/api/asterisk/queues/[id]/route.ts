import { NextResponse, type NextRequest } from 'next/server';
import { getAmiClient } from '@/lib/asterisk/ami-client';
import { withUser } from '@/lib/auth/rbac';
import type { JwtPayload } from '@/lib/auth/jwt';

type Params = { params: { id: string } };

export const GET = withUser(async (_req: NextRequest, _user: JwtPayload, { params }: Params) => {
  try {
    const ami = await getAmiClient();
    const output = await ami.command(`queue show ${params.id}`);
    return NextResponse.json({ data: { raw: output } });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
});

/** POST /api/asterisk/queues/[id]
 * actions: add_member | remove_member | pause | unpause | reset_stats
 */
export const POST = withUser(async (req: NextRequest, _user: JwtPayload, { params }: Params) => {
  const body = await req.json() as { action: string; extension?: string };
  const queue = params.id;

  if (!body.action) return NextResponse.json({ error: 'action is required' }, { status: 400 });

  try {
    const ami = await getAmiClient();

    if (body.action === 'add_member') {
      if (!body.extension) return NextResponse.json({ error: 'extension required' }, { status: 400 });
      const r = await ami.sendAction({
        Action: 'QueueAdd',
        Queue: queue,
        Interface: `PJSIP/${body.extension}`,
        Penalty: '0',
        Paused: 'false',
        MemberName: body.extension,
      });
      return NextResponse.json({ ok: r.Response === 'Success', data: r });
    }

    if (body.action === 'remove_member') {
      if (!body.extension) return NextResponse.json({ error: 'extension required' }, { status: 400 });
      const r = await ami.sendAction({
        Action: 'QueueRemove',
        Queue: queue,
        Interface: `PJSIP/${body.extension}`,
      });
      return NextResponse.json({ ok: r.Response === 'Success', data: r });
    }

    if (body.action === 'pause' || body.action === 'unpause') {
      if (!body.extension) return NextResponse.json({ error: 'extension required' }, { status: 400 });
      const r = await ami.sendAction({
        Action: 'QueuePause',
        Queue: queue,
        Interface: `PJSIP/${body.extension}`,
        Paused: body.action === 'pause' ? 'true' : 'false',
        Reason: body.action === 'pause' ? 'Supervisor paused' : '',
      });
      return NextResponse.json({ ok: r.Response === 'Success', data: r });
    }

    if (body.action === 'reset_stats') {
      // QueueReset resets the call statistics for a queue (supported Asterisk 16+)
      const r = await ami.sendAction({ Action: 'QueueReset', Queue: queue });
      return NextResponse.json({ ok: r.Response === 'Success', data: r });
    }

    return NextResponse.json({ error: `Unknown action: ${body.action}` }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 502 });
  }
});

/** DELETE /api/asterisk/queues/[id]
 * Removes all members from the queue and resets its stats.
 * Note: Asterisk has no AMI action to fully delete a dynamic queue — you need
 * to also remove the queue definition from queues.conf.
 */
export const DELETE = withUser(async (_req: NextRequest, _user: JwtPayload, { params }: Params) => {
  try {
    const ami = await getAmiClient();
    // Get current members via CLI then remove them one by one
    const statusOutput = await ami.command(`queue show ${params.id}`);

    // Parse member interface names from output (format: " PJSIP/1001 ...")
    const memberMatches = [...statusOutput.matchAll(/\s+(PJSIP\/\S+)\s+/gi)];

    const results: Array<{ interface: string; ok: boolean }> = [];
    for (const m of memberMatches) {
      const iface = m[1];
      if (!iface) continue;
      const r = await ami.sendAction({
        Action: 'QueueRemove',
        Queue: params.id,
        Interface: iface,
      });
      results.push({ interface: iface, ok: r.Response === 'Success' });
    }

    // Reset queue stats
    await ami.sendAction({ Action: 'QueueReset', Queue: params.id }).catch(() => null);

    return NextResponse.json({
      ok: true,
      membersRemoved: results.length,
      note: 'Members removed. To fully delete the queue, remove it from queues.conf and reload.',
      results,
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 502 });
  }
});
