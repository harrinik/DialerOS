import { NextResponse, type NextRequest } from 'next/server';
import { connectDb } from '@/lib/db/connection';
import { AsteriskSettings } from '@/lib/db/models/AsteriskSettings';
import { withUser } from '@/lib/auth/rbac';
import { invalidateAriCache } from '@/lib/asterisk/ari-client';
import type { JwtPayload } from '@/lib/auth/jwt';

export const GET = withUser(async (_req: NextRequest, _user: JwtPayload) => {
  await connectDb();
  const s = await AsteriskSettings.findOne({}).lean();
  if (!s) return NextResponse.json({ data: null });
  // Never return the raw password
  const { ariPassword: _a, amiPassword: _b, ...safe } = s as Record<string, unknown>;
  return NextResponse.json({ data: { ...safe, ariPassword: '••••••••', amiPassword: s.amiPassword ? '••••••••' : '' } });
});

export const PUT = withUser(async (req: NextRequest, _user: JwtPayload) => {
  await connectDb();
  const body = await req.json() as Record<string, unknown>;

  // Don't overwrite passwords if the placeholder was sent
  const update: Record<string, unknown> = { ...body };
  if (update.ariPassword === '••••••••') delete update.ariPassword;
  if (update.amiPassword === '••••••••') delete update.amiPassword;

  const s = await AsteriskSettings.findOneAndUpdate({}, update, { upsert: true, new: true, runValidators: true });
  invalidateAriCache();

  return NextResponse.json({ data: { ...s.toObject(), ariPassword: '••••••••', amiPassword: s.amiPassword ? '••••••••' : '' } });
});
