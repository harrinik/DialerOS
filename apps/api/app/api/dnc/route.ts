import { NextResponse, type NextRequest } from 'next/server';
import { createHash } from 'node:crypto';
import { connectDb } from '@/lib/db/connection';
import { DncList } from '@/lib/db/models/DncList';
import { AuditLog } from '@/lib/db/models/AuditLog';
import { withAuth, withUser } from '@/lib/auth/rbac';
import type { JwtPayload } from '@/lib/auth/jwt';

function normalizePhone(phone: string): string {
  return phone.replace(/[^+\d]/g, '');
}

// GET /api/dnc — list DNC entries (admin only)
export const GET = withAuth(async (req: NextRequest, user: JwtPayload) => {
  await connectDb();
  const { searchParams } = new URL(req.url);
  const page = Number(searchParams.get('page') ?? 1);
  const limit = Math.min(Number(searchParams.get('limit') ?? 100), 500);
  const skip = (page - 1) * limit;

  const [data, total] = await Promise.all([
    DncList.find().sort({ addedAt: -1 }).skip(skip).limit(limit).lean(),
    DncList.countDocuments(),
  ]);

  return NextResponse.json({ data, total, page, limit });
}, ['admin']);

// POST /api/dnc — add number to DNC
export const POST = withAuth(async (req: NextRequest, user: JwtPayload) => {
  await connectDb();
  const body = await req.json() as { phone: string; reason?: string; source?: string };
  const phone = normalizePhone(body.phone);
  const hash = createHash('sha256').update(phone).digest('hex');

  // Upsert — idempotent
  const entry = await DncList.findOneAndUpdate(
    { phoneHash: hash },
    { phone, phoneHash: hash, reason: body.reason, source: body.source ?? 'manual', addedBy: user.sub, addedAt: new Date() },
    { upsert: true, new: true },
  );

  await AuditLog.create({
    userId: user.sub,
    action: 'dnc.add',
    resource: 'DncEntry',
    resourceId: String(entry._id),
    metadata: { phone },
    ip: req.headers.get('x-forwarded-for') ?? '0.0.0.0',
  });

  return NextResponse.json({ data: entry }, { status: 201 });
}, ['admin']);
