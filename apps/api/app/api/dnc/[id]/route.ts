import { NextResponse, type NextRequest } from 'next/server';
import { connectDb } from '@/lib/db/connection';
import { DncList } from '@/lib/db/models/DncList';
import { AuditLog } from '@/lib/db/models/AuditLog';
import { withAuth } from '@/lib/auth/rbac';
import type { JwtPayload } from '@/lib/auth/jwt';

type RouteParams = { params: { id: string } };

export const DELETE = withAuth(
  async (req: NextRequest, user: JwtPayload, { params }: RouteParams) => {
    await connectDb();
    const entry = await DncList.findById(params.id);
    if (!entry) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const phone = entry.phone as string;
    await entry.deleteOne();

    await AuditLog.create({
      userId: user.sub,
      action: 'dnc.remove',
      resource: 'DncEntry',
      resourceId: params.id,
      metadata: { phone },
      ip: req.headers.get('x-forwarded-for') ?? '0.0.0.0',
    });

    return NextResponse.json({ message: 'Removed from DNC' });
  },
  ['admin'],
);
