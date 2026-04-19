import { NextResponse, type NextRequest } from 'next/server';
import { connectDb } from '@/lib/db/connection';
import { InboundRoute } from '@/lib/db/models/InboundRoute';
import { withUser } from '@/lib/auth/rbac';
import type { JwtPayload } from '@/lib/auth/jwt';

type Params = { params: { id: string } };

export const PUT = withUser(async (req: NextRequest, _user: JwtPayload, { params }: Params) => {
  await connectDb();
  const body = await req.json() as Record<string, unknown>;
  const doc = await InboundRoute.findByIdAndUpdate(params.id, body, { new: true, runValidators: true });
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ data: doc });
});

export const DELETE = withUser(async (_req: NextRequest, _user: JwtPayload, { params }: Params) => {
  await connectDb();
  await InboundRoute.findByIdAndDelete(params.id);
  return NextResponse.json({ ok: true });
});
