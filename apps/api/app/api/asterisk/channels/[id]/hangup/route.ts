import { NextResponse, type NextRequest } from 'next/server';
import { ariDelete, ariPost } from '@/lib/asterisk/ari-client';
import { getAmiClient } from '@/lib/asterisk/ami-client';
import { withUser } from '@/lib/auth/rbac';
import type { JwtPayload } from '@/lib/auth/jwt';

type Params = { params: { id: string } };

/** POST /api/asterisk/channels/[id]/hangup */
export const POST = withUser(async (req: NextRequest, user: JwtPayload, { params }: Params) => {
  const body = await req.json().catch(() => ({})) as { reason?: string; spyExtension?: string; spyMode?: string };
  const channelId = decodeURIComponent(params.id);

  // Hangup
  if (!body.spyExtension) {
    try {
      await ariDelete(`/channels/${encodeURIComponent(channelId)}`);
      return NextResponse.json({ ok: true });
    } catch (err) {
      return NextResponse.json({ ok: false, error: String(err) }, { status: 502 });
    }
  }

  // Spy / barge-in — use AMI Originate to ChanSpy
  const mode = body.spyMode ?? 'q'; // q=listen, w=whisper, barge=B
  try {
    const ami = await getAmiClient();
    const resp = await ami.sendAction({
      Action: 'Originate',
      Channel: `PJSIP/${body.spyExtension}`,
      Application: 'ChanSpy',
      Data: `${channelId},${mode}`,
      CallerID: `"Supervisor" <9000>`,
      Async: 'yes',
      Variable: `CALLERID(name)=Supervisor`,
    });
    return NextResponse.json({ ok: resp.Response === 'Success', data: resp });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 502 });
  }
});
