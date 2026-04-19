import { NextResponse, type NextRequest } from 'next/server';
import { ariGet, ariInfo } from '@/lib/asterisk/ari-client';
import { getAmiClient } from '@/lib/asterisk/ami-client';
import { withUser } from '@/lib/auth/rbac';
import type { JwtPayload } from '@/lib/auth/jwt';

export const GET = withUser(async (_req: NextRequest, _user: JwtPayload) => {
  try {
    // ARI: get version + startup time
    const info = await ariInfo();

    // AMI: get core version string + module count + PJSIP endpoint summary
    const ami = await getAmiClient();

    const [coreVersionOutput, moduleListOutput, sipPeersOutput] = await Promise.all([
      ami.command('core show version'),
      ami.command('module show like res_pjsip'),     // smaller, faster than full module show
      ami.command('pjsip show endpoints'),
    ]);

    // Parse module count: "X modules loaded" — fix regex to capture the number
    const moduleCountMatch = moduleListOutput.match(/(\d+)\s+module/i);
    const moduleCount = moduleCountMatch?.[1] ? `${moduleCountMatch[1]} PJSIP modules` : 'unknown';

    // Last 5 lines of pjsip show endpoints (the summary line)
    const sipEndpointSummary = sipPeersOutput.split('\n').filter(Boolean).slice(-5).join('\n');

    return NextResponse.json({
      data: {
        version: info.build?.version,
        startupTime: info.status?.startup_time,
        coreStatus: coreVersionOutput.trim(),
        moduleCount,
        sipEndpointSummary,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
});

export const POST = withUser(async (req: NextRequest, _user: JwtPayload) => {
  const { action } = await req.json() as { action: string };

  if (!action) return NextResponse.json({ error: 'action is required' }, { status: 400 });

  try {
    const ami = await getAmiClient();

    switch (action) {
      case 'reload': {
        const resp = await ami.sendAction({ Action: 'Reload' });
        return NextResponse.json({ ok: resp.Response === 'Success', data: resp });
      }
      case 'reload_dialplan': {
        const out = await ami.command('dialplan reload');
        return NextResponse.json({ ok: true, output: out });
      }
      case 'reload_pjsip': {
        const out = await ami.command('module reload res_pjsip.so');
        return NextResponse.json({ ok: true, output: out });
      }
      case 'reload_queues': {
        const out = await ami.command('module reload app_queue.so');
        return NextResponse.json({ ok: true, output: out });
      }
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 502 });
  }
});
