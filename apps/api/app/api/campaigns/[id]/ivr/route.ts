import { NextResponse, type NextRequest } from 'next/server';
import { connectDb } from '@/lib/db/connection';
import { Campaign } from '@/lib/db/models/Campaign';
import { withAuth } from '@/lib/auth/rbac';
import type { JwtPayload } from '@/lib/auth/jwt';

type RouteParams = { params: { id: string } };

/**
 * PATCH /api/campaigns/:id/ivr
 * Update only the IVR flow association. Allowed even while the campaign is running
 * since it only affects calls originated after the change.
 */
export const PATCH = withAuth(
  async (req: NextRequest, user: JwtPayload, { params }: RouteParams) => {
    await connectDb();

    const campaign = await Campaign.findById(params.id);
    if (!campaign) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    if (user.role !== 'admin' && String(campaign.ownerId) !== user.sub) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json() as { ivrFlowId?: string | null };

    if (body.ivrFlowId === undefined) {
      return NextResponse.json({ error: 'ivrFlowId is required' }, { status: 400 });
    }

    campaign.ivrFlowId = body.ivrFlowId ?? undefined;
    await campaign.save();

    return NextResponse.json({ data: { ivrFlowId: campaign.ivrFlowId } });
  },
  ['admin', 'user'],
);
