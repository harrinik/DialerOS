import { NextResponse, type NextRequest } from 'next/server';
import { getAmiClient } from '@/lib/asterisk/ami-client';
import { withUser } from '@/lib/auth/rbac';
import type { JwtPayload } from '@/lib/auth/jwt';

/**
 * POST /api/asterisk/ami
 * Body: { action: string; fields?: Record<string, string> }
 * Returns the AMI response packet as JSON.
 */
export const POST = withUser(async (req: NextRequest, _user: JwtPayload) => {
  const { action, fields = {} } = await req.json() as { action: string; fields?: Record<string, string> };

  try {
    const ami = await getAmiClient();
    const resp = await ami.sendAction({ Action: action, ...fields });
    return NextResponse.json({ ok: resp.Response === 'Success' || !resp.Response, data: resp });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 502 });
  }
});
