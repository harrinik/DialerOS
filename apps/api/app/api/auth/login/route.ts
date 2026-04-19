import { NextResponse, type NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { connectDb } from '@/lib/db/connection';
import { User } from '@/lib/db/models/User';
import { AuditLog } from '@/lib/db/models/AuditLog';
import { signAccessToken, signRefreshToken } from '@/lib/auth/jwt';
import { LoginSchema } from '@dialer/shared';

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    await connectDb();

    const body = await req.json() as unknown;
    const parsed = LoginSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { email, password } = parsed.data;

    const user = await User.findOne({ email, isActive: true })
      .select('+passwordHash +refreshTokens')
      .lean();

    if (!user) {
      return NextResponse.json(
        { error: 'Invalid credentials' },
        { status: 401 },
      );
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      return NextResponse.json(
        { error: 'Invalid credentials' },
        { status: 401 },
      );
    }

    const tokenPayload = { sub: String(user._id), email: user.email, role: user.role };
    const accessToken = signAccessToken(tokenPayload);
    const refreshToken = signRefreshToken(tokenPayload);

    // Cap refresh tokens at 10 per user (rotate out oldest)
    const tokens = [...(user.refreshTokens ?? []), refreshToken].slice(-10);
    await User.updateOne(
      { _id: user._id },
      { $set: { refreshTokens: tokens, lastLogin: new Date() } },
    );

    await AuditLog.create({
      userId: user._id,
      action: 'user.login',
      resource: 'User',
      resourceId: String(user._id),
      ip: req.headers.get('x-forwarded-for') ?? '0.0.0.0',
      userAgent: req.headers.get('user-agent') ?? '',
    });

    return NextResponse.json({
      accessToken,
      refreshToken,
      user: { id: user._id, email: user.email, name: user.name, role: user.role },
    });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
