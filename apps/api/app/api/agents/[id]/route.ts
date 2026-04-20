import { NextResponse, type NextRequest } from 'next/server';
import { connectDb } from '@/lib/db/connection';
import { Agent } from '@/lib/db/models/Agent';
import { AuditLog } from '@/lib/db/models/AuditLog';
import { User } from '@/lib/db/models/User';
import { AgentQrLoginToken } from '@/lib/db/models/AgentQrLoginToken';
import { deletePjsipEndpoint } from '@/lib/asterisk/pjsip-endpoints';
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
    const extensionDeleted = await deletePjsipEndpoint(agent.extension);

    await User.deleteOne({ _id: agent.userId, role: 'agent' });
    await AgentQrLoginToken.deleteMany({ agentId: agent._id });
    await agent.deleteOne();

    await AuditLog.create({
      userId: user.sub,
      action: 'agent.delete',
      resource: 'Agent',
      resourceId: params.id,
      metadata: { extension: agent.extension, userId: String(agent.userId), extensionDeleted },
      ip: req.headers.get('x-forwarded-for') ?? '0.0.0.0',
    });

    return NextResponse.json({ message: 'Agent deleted' });
  },
  ['admin'],
);
