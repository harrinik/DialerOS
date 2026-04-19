import { NextResponse, type NextRequest } from 'next/server';
import { connectDb } from '@/lib/db/connection';
import { Campaign } from '@/lib/db/models/Campaign';
import { AuditLog } from '@/lib/db/models/AuditLog';
import { withAuth } from '@/lib/auth/rbac';
import { UpdateCampaignSchema } from '@dialer/shared';
import type { JwtPayload } from '@/lib/auth/jwt';

type RouteParams = { params: { id: string } };

// GET /api/campaigns/:id
export const GET = withAuth(async (req: NextRequest, user: JwtPayload, { params }: RouteParams) => {
  await connectDb();
  const campaign = await Campaign.findById(params.id)
    .populate('ivrFlowId', 'name isDeployed')
    .lean();

  if (!campaign) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Non-admins can only see their own campaigns
  if (user.role !== 'admin' && String(campaign.ownerId) !== user.sub) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return NextResponse.json({ data: campaign });
});

// PUT /api/campaigns/:id
export const PUT = withAuth(
  async (req: NextRequest, user: JwtPayload, { params }: RouteParams) => {
    await connectDb();

    const campaign = await Campaign.findById(params.id);
    if (!campaign) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    if (user.role !== 'admin' && String(campaign.ownerId) !== user.sub) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (campaign.status === 'running') {
      return NextResponse.json(
        { error: 'Cannot update a running campaign. Pause it first.' },
        { status: 409 },
      );
    }

    const body = await req.json() as unknown;
    const parsed = UpdateCampaignSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    Object.assign(campaign, parsed.data);
    await campaign.save();

    await AuditLog.create({
      userId: user.sub,
      action: 'campaign.update',
      resource: 'Campaign',
      resourceId: params.id,
      metadata: parsed.data,
      ip: req.headers.get('x-forwarded-for') ?? '0.0.0.0',
    });

    return NextResponse.json({ data: campaign });
  },
  ['admin', 'user'],
);

// DELETE /api/campaigns/:id
export const DELETE = withAuth(
  async (req: NextRequest, user: JwtPayload, { params }: RouteParams) => {
    await connectDb();

    const campaign = await Campaign.findById(params.id);
    if (!campaign) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    if (campaign.status === 'running') {
      return NextResponse.json(
        { error: 'Stop the campaign before deleting' },
        { status: 409 },
      );
    }

    await campaign.deleteOne();

    await AuditLog.create({
      userId: user.sub,
      action: 'campaign.delete',
      resource: 'Campaign',
      resourceId: params.id,
      ip: req.headers.get('x-forwarded-for') ?? '0.0.0.0',
    });

    return NextResponse.json({ message: 'Campaign deleted' });
  },
  ['admin'],
);
