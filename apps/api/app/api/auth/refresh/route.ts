import { NextResponse, type NextRequest } from 'next/server';
import { connectDb } from '@/lib/db/connection';
import { User } from '@/lib/db/models/User';
import { verifyRefreshToken, signAccessToken, signRefreshToken } from '@/lib/auth/jwt';
import { RefreshTokenSchema } from '@dialer/shared';

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    await connectDb();

    const body = await req.json() as unknown;
    const parsed = RefreshTokenSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Refresh token required' }, { status: 400 });
    }

    const { refreshToken } = parsed.data;

    let payload;
    try {
      payload = verifyRefreshToken(refreshToken);
    } catch {
      return NextResponse.json({ error: 'Invalid refresh token' }, { status: 401 });
    }

    // Verify token is in the user's list (validates it hasn't been revoked)
    const user = await User.findById(payload.sub)
      .select('+refreshTokens')
      .lean();

    if (!user || !user.isActive || !user.refreshTokens?.includes(refreshToken)) {
      return NextResponse.json({ error: 'Refresh token revoked' }, { status: 401 });
    }

    // Rotate: remove old token, add new one
    const newRefreshToken = signRefreshToken({
      sub: String(user._id),
      email: user.email,
      role: user.role,
    });

    const updatedTokens = [
      ...(user.refreshTokens.filter((t) => t !== refreshToken)),
      newRefreshToken,
    ].slice(-10);

    await User.updateOne(
      { _id: user._id },
      { $set: { refreshTokens: updatedTokens } },
    );

    const accessToken = signAccessToken({
      sub: String(user._id),
      email: user.email,
      role: user.role,
    });

    return NextResponse.json({ accessToken, refreshToken: newRefreshToken });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
