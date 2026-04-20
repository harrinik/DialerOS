import { NextResponse, type NextRequest } from 'next/server';
import crypto from 'crypto';
import { connectDb } from '@/lib/db/connection';
import { User } from '@/lib/db/models/User';
import { AuditLog } from '@/lib/db/models/AuditLog';
import { AgentQrLoginToken } from '@/lib/db/models/AgentQrLoginToken';
import { signAccessToken, signRefreshToken } from '@/lib/auth/jwt';

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    await connectDb();
    const body = await req.json() as { token?: string };
    const rawToken = String(body.token ?? '').trim();
    if (!rawToken) {
      return NextResponse.json({ error: 'token is required' }, { status: 400 });
    }

    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const tokenDoc = await AgentQrLoginToken.findOne({
      tokenHash,
      usedAt: { $exists: false },
      expiresAt: { $gt: new Date() },
    }).lean();

    if (!tokenDoc) {
      return NextResponse.json({ error: 'Invalid or expired QR token' }, { status: 401 });
    }

    const user = await User.findById(tokenDoc.userId)
      .select('+refreshTokens')
      .lean();

    if (!user || !user.isActive || user.role !== 'agent') {
      return NextResponse.json({ error: 'Agent account is unavailable' }, { status: 401 });
    }

    const tokenPayload = { sub: String(user._id), email: user.email, role: user.role };
    const accessToken = signAccessToken(tokenPayload);
    const refreshToken = signRefreshToken(tokenPayload);
    const tokens = [...(user.refreshTokens ?? []), refreshToken].slice(-10);

    await Promise.all([
      User.updateOne(
        { _id: user._id },
        { $set: { refreshTokens: tokens, lastLogin: new Date() } },
      ),
      AgentQrLoginToken.updateOne(
        { _id: tokenDoc._id },
        { $set: { usedAt: new Date() } },
      ),
      AuditLog.create({
        userId: user._id,
        action: 'user.login.qr',
        resource: 'User',
        resourceId: String(user._id),
        ip: req.headers.get('x-forwarded-for') ?? '0.0.0.0',
        userAgent: req.headers.get('user-agent') ?? '',
      }),
    ]);

    return NextResponse.json({
      accessToken,
      refreshToken,
      user: { id: user._id, email: user.email, name: user.name, role: user.role },
    });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
