import { NextResponse, type NextRequest } from 'next/server';
import { createHash } from 'node:crypto';
import { connectDb } from '@/lib/db/connection';
import { DncList } from '@/lib/db/models/DncList';
import { AuditLog } from '@/lib/db/models/AuditLog';
import { withAuth } from '@/lib/auth/rbac';
import type { JwtPayload } from '@/lib/auth/jwt';

// GET /api/dnc/check?phone=+1555...
export const GET = withAuth(async (req: NextRequest, user: JwtPayload) => {
  await connectDb();
  const phone = new URL(req.url).searchParams.get('phone') ?? '';
  const normalized = phone.replace(/[^+\d]/g, '');
  const hash = createHash('sha256').update(normalized).digest('hex');
  const entry = await DncList.findOne({ phoneHash: hash }).lean();
  return NextResponse.json({ isBlocked: !!entry, entry: entry ?? null });
});
