import { NextResponse, type NextRequest } from 'next/server';
import { connectDb } from '@/lib/db/connection';
import { Agent } from '@/lib/db/models/Agent';
import { AuditLog } from '@/lib/db/models/AuditLog';
import type { AgentStatus } from '@dialer/shared';
import { withAuth } from '@/lib/auth/rbac';
import type { JwtPayload } from '@/lib/auth/jwt';

type RouteParams = { params: { id: string } };

const VALID_STATUSES: AgentStatus[] = ['available', 'busy', 'offline', 'paused', 'wrapup', 'training'];

export const POST = withAuth(async (req: NextRequest, user: JwtPayload, { params }: RouteParams) => {
  await connectDb();
  const agent = await Agent.findById(params.id);
  if (!agent) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json() as Record<string, unknown>;
  const newStatus = String(body['status'] ?? '') as AgentStatus;

  if (!VALID_STATUSES.includes(newStatus)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
  }

  const oldStatus = agent.status;
  agent.status = newStatus;

  // If going to wrapup, we should clear the current call
  if (newStatus === 'wrapup' || newStatus === 'paused' || newStatus === 'training') {
    agent.currentCallId = null;
  }

  await agent.save();

  await AuditLog.create({
    userId: user.sub,
    action: 'agent.status_change',
    resource: 'Agent',
    resourceId: params.id,
    metadata: { oldStatus, newStatus },
    ip: req.headers.get('x-forwarded-for') ?? '0.0.0.0',
  });

  return NextResponse.json({ data: { _id: agent._id, status: agent.status, previousStatus: oldStatus } });
});
