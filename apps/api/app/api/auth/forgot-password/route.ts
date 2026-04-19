import { NextResponse, type NextRequest } from 'next/server';
import { connectDb } from '@/lib/db/connection';
import { User } from '@/lib/db/models/User';

/**
 * POST /api/auth/forgot-password
 * Accepts an email and would send a reset link.
 * Always returns 200 to prevent email enumeration attacks.
 * Password reset email delivery requires an SMTP integration (e.g. Nodemailer + Resend/SendGrid).
 * TODO: integrate SMTP_HOST / SMTP_FROM env vars and send tokenised reset URL.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    await connectDb();
    const body = await req.json() as { email?: string };
    const email = (body.email ?? '').trim().toLowerCase();

    if (email) {
      // Check user exists (but don't reveal this to the caller)
      const user = await User.findOne({ email }).lean();
      if (user) {
        // TODO: generate a signed reset token and email it
        // const resetToken = crypto.randomBytes(32).toString('hex');
        // await sendResetEmail(email, resetToken);
        // Store token hash + expiry on user document
      }
    }

    // Always return 200 — prevents email enumeration
    return NextResponse.json({ ok: true });
  } catch {
    // Still return 200 to prevent enumeration through timing
    return NextResponse.json({ ok: true });
  }
}
