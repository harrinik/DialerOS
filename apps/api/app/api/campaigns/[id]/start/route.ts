import { NextResponse, type NextRequest } from 'next/server';
import { connectDb } from '@/lib/db/connection';
import { Campaign } from '@/lib/db/models/Campaign';
import { AuditLog } from '@/lib/db/models/AuditLog';
import { withUser } from '@/lib/auth/rbac';
import { enqueuePendingCampaignContacts } from '@/lib/campaigns/enqueue-pending-contacts';
import type { JwtPayload } from '@/lib/auth/jwt';

type RouteParams = { params: { id: string } };

export const POST = withUser(
  async (req: NextRequest, user: JwtPayload, { params }: RouteParams) => {
    await connectDb();

    const campaign = await Campaign.findById(params.id);
    if (!campaign) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    if (user.role !== 'admin' && String(campaign.ownerId) !== user.sub) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (campaign.status === 'running') {
      return NextResponse.json(
        { error: 'Campaign is already running' },
        { status: 409 },
      );
    }

    if (campaign.status === 'completed' || campaign.status === 'archived') {
      return NextResponse.json(
        { error: `Cannot start a ${campaign.status} campaign` },
        { status: 409 },
      );
    }

    // Set campaign to running
    campaign.status = 'running';
    await campaign.save();

    const contactsEnqueued = await enqueuePendingCampaignContacts(campaign);

    await AuditLog.create({
      userId: user.sub,
      action: 'campaign.start',
      resource: 'Campaign',
      resourceId: params.id,
      metadata: { contactsEnqueued },
      ip: req.headers.get('x-forwarded-for') ?? '0.0.0.0',
    });

    return NextResponse.json({
      message: 'Campaign started',
      contactsEnqueued,
    });
  },
);
