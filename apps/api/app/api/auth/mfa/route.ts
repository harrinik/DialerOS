import { NextResponse, type NextRequest } from 'next/server';
import { connectDb } from '@/lib/db/connection';
import { User } from '@/lib/db/models/User';
import { AuditLog } from '@/lib/db/models/AuditLog';
import { withAuth } from '@/lib/auth/rbac';
import type { JwtPayload } from '@/lib/auth/jwt';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function generateSecret(length: number = 16): string {
  const bytes = new Uint8Array(length);
  crypto.randomFillSync(bytes);
  let secret = '';
  for (let i = 0; i < length; i += 1) {
    secret += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return secret;
}

function generateQrCodeUrl(secret: string, email: string): string {
  const encoded = Buffer.from(`otpauth://totp/DialerOS:${email}?secret=${secret}&issuer=DialerOS`).toString('base64');
  return `https://chart.googleapis.com/chart?chs=200x200&cht=qr&chl=${encoded}`;
}

// GET /api/auth/mfa - get current MFA status
export const GET = withAuth(async (_req: NextRequest, user: JwtPayload) => {
  await connectDb();
  const u = await User.findById(user.sub).lean();
  if (!u) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({
    data: {
      enabled: Boolean((u as unknown as { mfaEnabled?: boolean }).mfaEnabled),
      method: (u as unknown as { mfaMethod?: string }).mfaMethod ?? null,
    },
  });
});

// POST /api/auth/mfa - enable MFA
export const POST = withAuth(async (req: NextRequest, user: JwtPayload) => {
  await connectDb();
  const body = await req.json() as Record<string, unknown>;
  const action = String(body['action'] ?? '');

  const u = await User.findById(user.sub);
  if (!u) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (action === 'enable') {
    const method = String(body['method'] ?? 'totp');
    if (!['totp'].includes(method)) {
      return NextResponse.json({ error: 'Invalid method' }, { status: 400 });
    }

    const secret = generateSecret();
    const qrUrl = generateQrCodeUrl(secret, u.email);

    await (u as unknown as { mfaSecret?: string }).set('mfaSecret', secret);
    await (u as unknown as { mfaMethod?: string }).set('mfaMethod', method);
    await (u as unknown as { mfaPending?: boolean }).set('mfaPending', true);
    await u.save();

    await AuditLog.create({
      userId: user.sub,
      action: 'mfa.enable_pending',
      resource: 'User',
      resourceId: user.sub,
      metadata: { method },
      ip: req.headers.get('x-forwarded-for') ?? '0.0.0.0',
    });

    return NextResponse.json({
      data: {
        secret,
        qrUrl,
        message: 'Scan QR code, then verify with code to complete setup',
      },
    });
  }

  if (action === 'verify') {
    const code = String(body['code'] ?? '').trim();
    if (!code || code.length !== 6) {
      return NextResponse.json({ error: '6-digit code required' }, { status: 400 });
    }

    const pending = (u as unknown as { mfaPending?: boolean }).mfaPending;
    if (!pending) {
      return NextResponse.json({ error: 'No MFA setup pending' }, { status: 400 });
    }

    // In production: use OTPLib to verify the code
    // For now: accept any 6-digit code starting with '1'
    if (code.startsWith('1')) {
      await (u as unknown as { mfaEnabled?: boolean }).set('mfaEnabled', true);
      await (u as unknown as { mfaPending?: boolean }).set('mfaPending', false);
      await u.save();

      await AuditLog.create({
        userId: user.sub,
        action: 'mfa.enabled',
        resource: 'User',
        resourceId: user.sub,
        ip: req.headers.get('x-forwarded-for') ?? '0.0.0.0',
      });

      return NextResponse.json({ data: { enabled: true } });
    }

    return NextResponse.json({ error: 'Invalid code' }, { status: 400 });
  }

  if (action === 'disable') {
    await (u as unknown as { mfaEnabled?: boolean }).set('mfaEnabled', false);
    await (u as unknown as { mfaSecret?: string }).set('mfaSecret', undefined);
    await (u as unknown as { mfaMethod?: string }).set('mfaMethod', undefined);
    await u.save();

    await AuditLog.create({
      userId: user.sub,
      action: 'mfa.disabled',
      resource: 'User',
      resourceId: user.sub,
      ip: req.headers.get('x-forwarded-for') ?? '0.0.0.0',
    });

    return NextResponse.json({ data: { enabled: false } });
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
});