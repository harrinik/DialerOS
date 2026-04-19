import { NextResponse, type NextRequest } from 'next/server';
import { connectDb } from '@/lib/db/connection';
import { Campaign } from '@/lib/db/models/Campaign';
import { AuditLog } from '@/lib/db/models/AuditLog';
import { withUser } from '@/lib/auth/rbac';
import type { JwtPayload } from '@/lib/auth/jwt';

type RouteParams = { params: { id: string } };

export const POST = withUser(
  async (req: NextRequest, user: JwtPayload, { params }: RouteParams) => {
    await connectDb();

    const campaign = await Campaign.findById(params.id);
    if (!campaign) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    if (campaign.status !== 'running') {
      return NextResponse.json(
        { error: 'Campaign is not running' },
        { status: 409 },
      );
    }

    campaign.status = 'paused';
    await campaign.save();

    // The BullMQ workers will drain naturally — no new jobs will be picked up
    // because the worker checks campaign.status before originating.
    // In a future enhancement, a Redis flag can signal workers to stop immediately.

    await AuditLog.create({
      userId: user.sub,
      action: 'campaign.pause',
      resource: 'Campaign',
      resourceId: params.id,
      ip: req.headers.get('x-forwarded-for') ?? '0.0.0.0',
    });

    return NextResponse.json({ message: 'Campaign paused' });
  },
);
