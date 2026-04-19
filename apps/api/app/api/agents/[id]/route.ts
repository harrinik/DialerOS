import { NextResponse, type NextRequest } from 'next/server';
import { connectDb } from '@/lib/db/connection';
import { Agent } from '@/lib/db/models/Agent';
import { AuditLog } from '@/lib/db/models/AuditLog';
import { withAuth } from '@/lib/auth/rbac';
import type { JwtPayload } from '@/lib/auth/jwt';

type RouteParams = { params: { id: string } };

// GET /api/agents/:id
export const GET = withAuth(async (req: NextRequest, user: JwtPayload, { params }: RouteParams) => {
  await connectDb();
  const agent = await Agent.findById(params.id).lean();
  if (!agent) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ data: agent });
});

// PATCH /api/agents/:id — update status or properties
export const PATCH = withAuth(
  async (req: NextRequest, user: JwtPayload, { params }: RouteParams) => {
    await connectDb();
    const agent = await Agent.findById(params.id);
    if (!agent) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const body = await req.json() as Record<string, unknown>;
    Object.assign(agent, body);
    await agent.save();

    await AuditLog.create({
      userId: user.sub,
      action: 'agent.update',
      resource: 'Agent',
      resourceId: params.id,
      metadata: body,
      ip: req.headers.get('x-forwarded-for') ?? '0.0.0.0',
    });

    return NextResponse.json({ data: agent });
  },
  ['admin', 'user'],
);

// DELETE /api/agents/:id
export const DELETE = withAuth(
  async (req: NextRequest, user: JwtPayload, { params }: RouteParams) => {
    await connectDb();
    const agent = await Agent.findById(params.id);
    if (!agent) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    await agent.deleteOne();

    await AuditLog.create({
      userId: user.sub,
      action: 'agent.delete',
      resource: 'Agent',
      resourceId: params.id,
      ip: req.headers.get('x-forwarded-for') ?? '0.0.0.0',
    });

    return NextResponse.json({ message: 'Agent deleted' });
  },
  ['admin'],
);
