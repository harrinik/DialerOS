import { NextResponse, type NextRequest } from 'next/server';
import { pjsipDelete } from '@/lib/asterisk/ari-client';
import { getAmiClient } from '@/lib/asterisk/ami-client';
import { withUser } from '@/lib/auth/rbac';
import type { JwtPayload } from '@/lib/auth/jwt';

type Params = { params: { id: string } };

export const DELETE = withUser(async (_req: NextRequest, _user: JwtPayload, { params }: Params) => {
  const id = params.id.startsWith('trunk-') ? params.id : `trunk-${params.id}`;
  try {
    await Promise.all([
      pjsipDelete('res_pjsip', 'endpoint', id),
      pjsipDelete('res_pjsip', 'aor', id),
      pjsipDelete('res_pjsip', 'auth', `auth-${id}`).catch(() => null),
      pjsipDelete('res_pjsip', 'registration', `reg-${id}`).catch(() => null),
    ]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 502 });
  }
});

export const POST = withUser(async (req: NextRequest, _user: JwtPayload, { params }: Params) => {
  const { action } = await req.json() as { action?: string };
  const id = params.id;
  try {
    const ami = await getAmiClient();
    if (action === 'qualify') {
      const resp = await ami.sendAction({ Action: 'PJSIPQualify', Endpoint: id });
      return NextResponse.json({ ok: true, data: resp });
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 502 });
  }
});
