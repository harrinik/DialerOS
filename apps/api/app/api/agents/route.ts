import { NextResponse, type NextRequest } from 'next/server';
import { connectDb } from '@/lib/db/connection';
import { Agent } from '@/lib/db/models/Agent';
import { AuditLog } from '@/lib/db/models/AuditLog';
import { withAuth, withUser } from '@/lib/auth/rbac';
import type { JwtPayload } from '@/lib/auth/jwt';

// GET /api/agents
export const GET = withUser(async (req: NextRequest, user: JwtPayload) => {
  await connectDb();
  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status');
  const filter: Record<string, unknown> = {};
  if (status) filter['status'] = status;
  const agents = await Agent.find(filter).sort({ name: 1 }).lean();
  return NextResponse.json({ data: agents });
});

// POST /api/agents
export const POST = withAuth(async (req: NextRequest, user: JwtPayload) => {
  await connectDb();
  const body = await req.json() as Record<string, unknown>;
  const agent = await Agent.create({ ...body, userId: body['userId'] ?? user.sub });

  await AuditLog.create({
    userId: user.sub,
    action: 'agent.create',
    resource: 'Agent',
    resourceId: String(agent._id),
    ip: req.headers.get('x-forwarded-for') ?? '0.0.0.0',
  });

  return NextResponse.json({ data: agent }, { status: 201 });
}, ['admin']);
