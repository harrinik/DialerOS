import { NextResponse, type NextRequest } from 'next/server';
import { connectDb } from '@/lib/db/connection';
import { Campaign } from '@/lib/db/models/Campaign';
import { Contact } from '@/lib/db/models/Contact';
import { AuditLog } from '@/lib/db/models/AuditLog';
import { withUser } from '@/lib/auth/rbac';
import { bulkEnqueueDialJobs } from '@/lib/queue';
import type { DialJobPayload } from '@dialer/shared';
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

    // Load all pending/retry contacts and enqueue them
    const contacts = await Contact.find({
      campaignId: campaign._id,
      status: { $in: ['pending', 'retry_scheduled'] },
      $or: [
        { nextRetryAt: { $exists: false } },
        { nextRetryAt: { $lte: new Date() } },
      ],
    })
      .select('_id phone retryCount')
      .lean();

    if (contacts.length > 0) {
      const jobs: DialJobPayload[] = contacts.map((c) => {
        const base = {
          contactId: String(c._id),
          campaignId: String(campaign._id),
          phone: c.phone as string,
          callerIdName: campaign.callerIdName,
          callerIdNumber: campaign.callerIdNumber,
          sipTrunk: campaign.sipTrunk,
          concurrencyLimit: campaign.concurrency,
          amdAction: campaign.amdAction,
          attempt: (c.retryCount as number) + 1,
        } satisfies Omit<DialJobPayload, 'ivrFlowId'>;
        return campaign.ivrFlowId
          ? { ...base, ivrFlowId: String(campaign.ivrFlowId) }
          : base;
      });

      await bulkEnqueueDialJobs(jobs);
    }

    await AuditLog.create({
      userId: user.sub,
      action: 'campaign.start',
      resource: 'Campaign',
      resourceId: params.id,
      metadata: { contactsEnqueued: contacts.length },
      ip: req.headers.get('x-forwarded-for') ?? '0.0.0.0',
    });

    return NextResponse.json({
      message: 'Campaign started',
      contactsEnqueued: contacts.length,
    });
  },
);
