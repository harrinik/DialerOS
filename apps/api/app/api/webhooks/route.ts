import { NextResponse, type NextRequest } from 'next/server';
import { connectDb } from '@/lib/db/connection';
import { WebhookSubscription } from '@/lib/db/models/WebhookSubscription';
import { withAuth } from '@/lib/auth/rbac';
import type { JwtPayload } from '@/lib/auth/jwt';

export const GET = withAuth(async (_req: NextRequest, user: JwtPayload) => {
  await connectDb();
  const subs = await WebhookSubscription.find({ ownerId: user.sub }).lean();
  return NextResponse.json({ data: subs });
});

export const POST = withAuth(async (req: NextRequest, user: JwtPayload) => {
  await connectDb();
  const body = await req.json() as Record<string, unknown>;

  const url = String(body['url'] ?? '').trim();
  const events = body['events'] as string[];
  const secret = String(body['secret'] ?? '').trim();

  if (!url || !url.startsWith('http')) {
    return NextResponse.json({ error: 'url is required and must be valid HTTP/HTTPS' }, { status: 400 });
  }

  if (!Array.isArray(events) || events.length === 0) {
    return NextResponse.json({ error: 'at least one event is required' }, { status: 400 });
  }

  const sub = await WebhookSubscription.create({
    ownerId: user.sub,
    url,
    events,
    ...(secret ? { secret } : {}),
    isActive: true,
  });

  return NextResponse.json({ data: sub }, { status: 201 });
}, ['admin', 'user']);
