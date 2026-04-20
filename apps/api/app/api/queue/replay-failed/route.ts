import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { withAuth } from '@/lib/auth/rbac';
import type { JwtPayload } from '@/lib/auth/jwt';
import { replayFailedDialJobs } from '@/lib/queue';

const ReplaySchema = z.object({
  limit: z.number().int().min(1).max(500).optional(),
});

export const POST = withAuth(async (req: NextRequest, _user: JwtPayload) => {
  const body = await req.json().catch(() => ({}));
  const parsed = ReplaySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid payload', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const result = await replayFailedDialJobs(parsed.data.limit ?? 100);
  return NextResponse.json({
    ok: true,
    ...result,
    replayedAt: new Date().toISOString(),
  });
}, ['admin']);
