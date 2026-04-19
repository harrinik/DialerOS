import { NextResponse, type NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { connectDb } from '@/lib/db/connection';
import { User } from '@/lib/db/models/User';
import { AuditLog } from '@/lib/db/models/AuditLog';
import { signAccessToken, signRefreshToken } from '@/lib/auth/jwt';
import { RegisterSchema } from '@dialer/shared';

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    await connectDb();

    const body = await req.json() as unknown;
    const parsed = RegisterSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { email, password, name, role } = parsed.data;

    const existing = await User.findOne({ email }).lean();
    if (existing) {
      return NextResponse.json({ error: 'Email already registered' }, { status: 409 });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({ email, name, passwordHash, role });

    const tokenPayload = { sub: String(user._id), email: user.email, role: user.role };
    const accessToken = signAccessToken(tokenPayload);
    const refreshToken = signRefreshToken(tokenPayload);

    // Store hashed refresh token
    await User.updateOne(
      { _id: user._id },
      { $push: { refreshTokens: refreshToken } },
    );

    // Audit log
    await AuditLog.create({
      userId: user._id,
      action: 'user.register',
      resource: 'User',
      resourceId: String(user._id),
      ip: req.headers.get('x-forwarded-for') ?? '0.0.0.0',
      userAgent: req.headers.get('user-agent') ?? '',
    });

    return NextResponse.json(
      {
        accessToken,
        refreshToken,
        user: { id: user._id, email: user.email, name: user.name, role: user.role },
      },
      { status: 201 },
    );
  } catch (err) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
