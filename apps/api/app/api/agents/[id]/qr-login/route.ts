import { NextResponse, type NextRequest } from 'next/server';
import crypto from 'crypto';
import { connectDb } from '@/lib/db/connection';
import { Agent } from '@/lib/db/models/Agent';
import { User } from '@/lib/db/models/User';
import { AuditLog } from '@/lib/db/models/AuditLog';
import { AgentQrLoginToken } from '@/lib/db/models/AgentQrLoginToken';
import { withAuth } from '@/lib/auth/rbac';
import type { JwtPayload } from '@/lib/auth/jwt';

type RouteParams = { params: { id: string } };

export const POST = withAuth(
  async (req: NextRequest, user: JwtPayload, { params }: RouteParams) => {
    await connectDb();

    const agent = await Agent.findById(params.id).lean();
    if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });

    const linkedUser = await User.findById(agent.userId).lean();
    if (!linkedUser || linkedUser.role !== 'agent' || !linkedUser.isActive) {
      return NextResponse.json({ error: 'Linked agent user is missing or inactive' }, { status: 409 });
    }

    await AgentQrLoginToken.deleteMany({
      agentId: agent._id,
      usedAt: { $exists: false },
      expiresAt: { $gt: new Date() },
    });

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await AgentQrLoginToken.create({
      userId: linkedUser._id,
      agentId: agent._id,
      tokenHash,
      expiresAt,
      createdBy: user.sub,
    });

    const loginUrl = `${req.nextUrl.origin}/login?qrToken=${encodeURIComponent(rawToken)}`;

    await AuditLog.create({
      userId: user.sub,
      action: 'agent.qr_login.issue',
      resource: 'Agent',
      resourceId: String(agent._id),
      metadata: { expiresAt: expiresAt.toISOString() },
      ip: req.headers.get('x-forwarded-for') ?? '0.0.0.0',
    });

    return NextResponse.json({
      data: {
        loginUrl,
        token: rawToken,
        expiresAt: expiresAt.toISOString(),
        email: linkedUser.email,
      },
    });
  },
  ['admin', 'user'],
);
