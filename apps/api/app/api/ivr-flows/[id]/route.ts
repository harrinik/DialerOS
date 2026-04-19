import { NextResponse, type NextRequest } from 'next/server';
import { connectDb } from '@/lib/db/connection';
import { IvrFlow } from '@/lib/db/models/IvrFlow';
import { AuditLog } from '@/lib/db/models/AuditLog';
import { withUser, withAuth } from '@/lib/auth/rbac';
import { UpdateIvrFlowSchema } from '@dialer/shared';
import type { JwtPayload } from '@/lib/auth/jwt';

type RouteParams = { params: { id: string } };

// GET /api/ivr-flows/:id
export const GET = withUser(async (req: NextRequest, user: JwtPayload, { params }: RouteParams) => {
  await connectDb();
  const flow = await IvrFlow.findById(params.id).lean();
  if (!flow) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ data: flow });
});

// PUT /api/ivr-flows/:id
export const PUT = withUser(
  async (req: NextRequest, user: JwtPayload, { params }: RouteParams) => {
    await connectDb();

    const flow = await IvrFlow.findById(params.id);
    if (!flow) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const body = await req.json() as unknown;
    const parsed = UpdateIvrFlowSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    // If saving new steps, mark as no longer deployed
    if (parsed.data.steps) {
      flow.isDeployed = false;
    }

    Object.assign(flow, parsed.data);
    await flow.save();

    await AuditLog.create({
      userId: user.sub,
      action: 'ivr_flow.update',
      resource: 'IvrFlow',
      resourceId: params.id,
      ip: req.headers.get('x-forwarded-for') ?? '0.0.0.0',
    });

    return NextResponse.json({ data: flow });
  },
);

// DELETE /api/ivr-flows/:id
export const DELETE = withAuth(
  async (req: NextRequest, user: JwtPayload, { params }: RouteParams) => {
    await connectDb();
    const flow = await IvrFlow.findById(params.id);
    if (!flow) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    await flow.deleteOne();

    await AuditLog.create({
      userId: user.sub,
      action: 'ivr_flow.delete',
      resource: 'IvrFlow',
      resourceId: params.id,
      ip: req.headers.get('x-forwarded-for') ?? '0.0.0.0',
    });

    return NextResponse.json({ message: 'Deleted' });
  },
  ['admin'],
);
