import { NextResponse, type NextRequest } from 'next/server';
import { ariGet } from '@/lib/asterisk/ari-client';
import { withUser } from '@/lib/auth/rbac';
import type { JwtPayload } from '@/lib/auth/jwt';

interface AriChannel {
  id: string;
  name: string;
  state: string;
  caller: { name: string; number: string };
  connected: { name: string; number: string };
  dialplan: { context: string; exten: string; priority: number };
  creationtime: string;
}

export const GET = withUser(async (_req: NextRequest, _user: JwtPayload) => {
  try {
    const channels = await ariGet<AriChannel[]>('/channels');
    return NextResponse.json({ data: channels });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
});
