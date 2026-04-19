import { NextResponse, type NextRequest } from 'next/server';
import { connectDb } from '@/lib/db/connection';
import { IvrFlow } from '@/lib/db/models/IvrFlow';
import { Campaign } from '@/lib/db/models/Campaign';
import { AuditLog } from '@/lib/db/models/AuditLog';
import { withUser } from '@/lib/auth/rbac';
import { CreateIvrFlowSchema, UpdateIvrFlowSchema } from '@dialer/shared';
import type { JwtPayload } from '@/lib/auth/jwt';

// GET /api/ivr-flows — list all flows
export const GET = withUser(
  async (req: NextRequest, user: JwtPayload) => {
    await connectDb();
    const { searchParams } = new URL(req.url);
    const campaignId = searchParams.get('campaignId');

    const filter = campaignId ? { campaignId } : {};
    const flows = await IvrFlow.find(filter)
      .sort({ createdAt: -1 })
      .lean();

    return NextResponse.json({ data: flows });
  },
);

// POST /api/ivr-flows — create new flow
export const POST = withUser(
  async (req: NextRequest, user: JwtPayload) => {
    await connectDb();

    const body = await req.json() as unknown;
    const parsed = CreateIvrFlowSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    // Validate entry step exists in steps
    const entryStep = parsed.data.steps.find(
      (s) => s.id === parsed.data.entryStepId,
    );
    if (!entryStep) {
      return NextResponse.json(
        { error: 'entryStepId must reference a step in the steps array' },
        { status: 400 },
      );
    }

    const flow = await IvrFlow.create(parsed.data);

    await AuditLog.create({
      userId: user.sub,
      action: 'ivr_flow.create',
      resource: 'IvrFlow',
      resourceId: String(flow._id),
      ip: req.headers.get('x-forwarded-for') ?? '0.0.0.0',
    });

    return NextResponse.json({ data: flow }, { status: 201 });
  },
);
