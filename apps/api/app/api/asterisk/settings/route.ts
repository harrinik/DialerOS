import { NextResponse, type NextRequest } from 'next/server';
import { connectDb } from '@/lib/db/connection';
import { AsteriskSettings } from '@/lib/db/models/AsteriskSettings';
import { withUser } from '@/lib/auth/rbac';
import { invalidateAriCache } from '@/lib/asterisk/ari-client';
import type { JwtPayload } from '@/lib/auth/jwt';

export const GET = withUser(async (_req: NextRequest, _user: JwtPayload) => {
  await connectDb();
  const s = await AsteriskSettings.findOne({}).lean() as unknown as Record<string, unknown> | null;
  if (!s) return NextResponse.json({ data: null });

  // Never return raw passwords — return boolean flags indicating whether they're set.
  const { ariPassword, amiPassword, ...safe } = s;
  return NextResponse.json({
    data: {
      ...safe,
      ariPasswordSet: !!ariPassword,
      amiPasswordSet: !!amiPassword,
    },
  });
});

export const PUT = withUser(async (req: NextRequest, _user: JwtPayload) => {
  await connectDb();
  const body = await req.json() as Record<string, unknown>;

  // Only include password fields if they are non-empty strings (user explicitly changed them)
  const update: Record<string, unknown> = { ...body };
  if (!update.ariPassword) delete update.ariPassword;
  if (!update.amiPassword) delete update.amiPassword;
  // Remove the boolean flag fields — they're read-only indicators, not stored columns
  delete update.ariPasswordSet;
  delete update.amiPasswordSet;

  const s = await AsteriskSettings.findOneAndUpdate(
    {},
    { $set: update },
    { upsert: true, new: true, runValidators: true },
  );
  invalidateAriCache();

  const obj = (s.toObject() as unknown) as Record<string, unknown>;
  const { ariPassword, amiPassword, ...safe } = obj;
  return NextResponse.json({
    data: {
      ...safe,
      ariPasswordSet: !!ariPassword,
      amiPasswordSet: !!amiPassword,
    },
  });
});
