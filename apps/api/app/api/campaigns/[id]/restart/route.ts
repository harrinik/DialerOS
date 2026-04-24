import { NextResponse, type NextRequest } from 'next/server';
import { connectDb } from '@/lib/db/connection';
import { Campaign } from '@/lib/db/models/Campaign';
import { Contact } from '@/lib/db/models/Contact';
import { AuditLog } from '@/lib/db/models/AuditLog';
import { withUser } from '@/lib/auth/rbac';
import { enqueuePendingCampaignContacts } from '@/lib/campaigns/enqueue-pending-contacts';
import type { JwtPayload } from '@/lib/auth/jwt';

type RouteParams = { params: { id: string } };

// POST /api/campaigns/:id/restart
// Resets completed/failed/machine contacts back to pending and starts the campaign.
// Accepts optional body: { resetStatuses?: string[] } to control which dispositions to re-dial.
export const POST = withUser(
  async (req: NextRequest, user: JwtPayload, { params }: RouteParams) => {
    await connectDb();

    const campaign = await Campaign.findById(params.id);
    if (!campaign) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    if (user.role !== 'admin' && String(campaign.ownerId) !== user.sub) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (campaign.status === 'running') {
      return NextResponse.json({ error: 'Campaign is already running' }, { status: 409 });
    }

    // Determine which contact statuses to reset
    let body: { resetStatuses?: string[] } = {};
    try { body = (await req.json()) as typeof body; } catch { /* no body is fine */ }

    const resetStatuses = (body.resetStatuses && body.resetStatuses.length > 0)
      ? body.resetStatuses
      : ['completed', 'failed', 'no_answer', 'machine', 'busy', 'cancelled', 'dnc_skip'];

    // Reset matching contacts to pending so they get re-dialled
    const resetResult = await Contact.updateMany(
      { campaignId: campaign._id, status: { $in: resetStatuses } },
      {
        $set: {
          status: 'pending',
          nextRetryAt: null,
        },
        $unset: { nextRetryAt: '' },
      },
    );

    // Reset campaign to running (clamp active to 0; leave historical stats intact)
    campaign.status = 'running';
    (campaign.stats as Record<string, unknown>)['active'] = 0;
    await campaign.save();

    const contactsEnqueued = await enqueuePendingCampaignContacts(campaign);

    await AuditLog.create({
      userId: user.sub,
      action: 'campaign.restart',
      resource: 'Campaign',
      resourceId: params.id,
      metadata: { contactsReset: resetResult.modifiedCount, contactsEnqueued, resetStatuses },
      ip: req.headers.get('x-forwarded-for') ?? '0.0.0.0',
    });

    return NextResponse.json({
      message: 'Campaign restarted',
      contactsReset: resetResult.modifiedCount,
      contactsEnqueued,
    });
  },
);
