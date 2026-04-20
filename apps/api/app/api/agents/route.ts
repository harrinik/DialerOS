import { NextResponse, type NextRequest } from 'next/server';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { connectDb } from '@/lib/db/connection';
import { Agent } from '@/lib/db/models/Agent';
import { AuditLog } from '@/lib/db/models/AuditLog';
import { User } from '@/lib/db/models/User';
import { deletePjsipEndpoint, upsertPjsipEndpoint } from '@/lib/asterisk/pjsip-endpoints';
import { withAuth, withUser } from '@/lib/auth/rbac';
import type { JwtPayload } from '@/lib/auth/jwt';

function generateTemporaryPassword(): string {
  return crypto.randomBytes(9).toString('base64url');
}

async function nextAvailableExtension(): Promise<string> {
  const agents = await Agent.find({}, { extension: 1 }).lean();
  const used = new Set<number>();
  for (const agent of agents) {
    const parsed = Number.parseInt(String(agent.extension ?? ''), 10);
    if (Number.isInteger(parsed)) used.add(parsed);
  }

  for (let candidate = 1000; candidate <= 9999; candidate += 1) {
    if (!used.has(candidate)) return String(candidate);
  }
  throw new Error('No free extension numbers available');
}

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
  const name = String(body['name'] ?? '').trim();
  const email = String(body['email'] ?? '').trim().toLowerCase();
  if (!name || !email) {
    return NextResponse.json({ error: 'name and email are required' }, { status: 400 });
  }

  const existingUser = await User.findOne({ email }).lean();
  if (existingUser) {
    return NextResponse.json({ error: 'Email already registered' }, { status: 409 });
  }

  const requestedExtension = String(body['extension'] ?? '').trim();
  const extension = requestedExtension || await nextAvailableExtension();
  const alreadyUsedExtension = await Agent.findOne({ extension }).lean();
  if (alreadyUsedExtension) {
    return NextResponse.json({ error: 'Extension already in use' }, { status: 409 });
  }

  const loginPassword = String(body['password'] ?? '').trim() || generateTemporaryPassword();
  const sipPassword = String(body['sipPassword'] ?? '').trim() || generateTemporaryPassword();

  const maxConcurrentCalls = Number(body['maxConcurrentCalls'] ?? 1);

  const endpointResult = await upsertPjsipEndpoint({
    extension,
    displayName: name,
    password: sipPassword,
    maxContacts: Number.isFinite(maxConcurrentCalls) ? maxConcurrentCalls : 1,
  });

  let createdUserId: string | null = null;
  try {
    const passwordHash = await bcrypt.hash(loginPassword, 12);
    const createdUser = await User.create({
      email,
      name,
      passwordHash,
      role: 'agent',
      isActive: true,
    });
    createdUserId = String(createdUser._id);

    const agent = await Agent.create({
      userId: createdUser._id,
      name,
      extension,
      sipEndpoint: `PJSIP/${endpointResult.extension}`,
      status: 'offline',
      campaignIds: Array.isArray(body['campaignIds']) ? body['campaignIds'] : [],
      maxConcurrentCalls: Number.isFinite(maxConcurrentCalls) ? maxConcurrentCalls : 1,
    });

    await AuditLog.create({
      userId: user.sub,
      action: 'agent.create',
      resource: 'Agent',
      resourceId: String(agent._id),
      metadata: {
        userId: createdUserId,
        extension,
        sipEndpoint: agent.sipEndpoint,
      },
      ip: req.headers.get('x-forwarded-for') ?? '0.0.0.0',
    });

    return NextResponse.json({
      data: agent,
      credentials: {
        email,
        loginPassword,
        extension,
        sipPassword: endpointResult.password,
      },
    }, { status: 201 });
  } catch (error) {
    if (createdUserId) {
      await User.deleteOne({ _id: createdUserId });
    }
    await deletePjsipEndpoint(extension);
    throw error;
  }
}, ['admin']);
