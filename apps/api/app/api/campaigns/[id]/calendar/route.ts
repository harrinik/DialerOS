import { NextResponse, type NextRequest } from 'next/server';
import { connectDb } from '@/lib/db/connection';
import { Campaign } from '@/lib/db/models/Campaign';
import { AuditLog } from '@/lib/db/models/AuditLog';
import { withAuth } from '@/lib/auth/rbac';
import type { JwtPayload } from '@/lib/auth/jwt';

type RouteParams = { params: { id: string } };

function normalizeDates(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((value) => String(value ?? '').trim())
    .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value));
}

export const GET = withAuth(async (_req: NextRequest, user: JwtPayload, { params }: RouteParams) => {
  await connectDb();
  const campaign = await Campaign.findById(params.id).select('ownerId timezone startTime endTime blackoutDates').lean();
  if (!campaign) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (user.role !== 'admin' && String(campaign.ownerId) !== user.sub) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return NextResponse.json({
    data: {
      timezone: campaign.timezone ?? 'UTC',
      startTime: campaign.startTime ?? null,
      endTime: campaign.endTime ?? null,
      blackoutDates: campaign.blackoutDates ?? [],
    },
  });
});

export const PUT = withAuth(async (req: NextRequest, user: JwtPayload, { params }: RouteParams) => {
  await connectDb();
  const campaign = await Campaign.findById(params.id);
  if (!campaign) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (user.role !== 'admin' && String(campaign.ownerId) !== user.sub) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json() as {
    timezone?: string;
    startTime?: string | null;
    endTime?: string | null;
    blackoutDates?: string[];
  };

  const update: Record<string, unknown> = {
    blackoutDates: normalizeDates(body.blackoutDates),
  };
  if (typeof body.timezone === 'string' && body.timezone.trim()) {
    update['timezone'] = body.timezone.trim();
  }
  if (body.startTime) update['startTime'] = body.startTime;
  else update['$unset'] = { ...(update['$unset'] as Record<string, 1> | undefined), startTime: 1 };
  if (body.endTime) update['endTime'] = body.endTime;
  else update['$unset'] = { ...(update['$unset'] as Record<string, 1> | undefined), endTime: 1 };

  await Campaign.updateOne({ _id: params.id }, update);
  const updated = await Campaign.findById(params.id).select('timezone startTime endTime blackoutDates').lean();
  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  await AuditLog.create({
    userId: user.sub,
    action: 'campaign.calendar.update',
    resource: 'Campaign',
    resourceId: params.id,
    metadata: {
      timezone: updated.timezone,
      startTime: updated.startTime ?? null,
      endTime: updated.endTime ?? null,
      blackoutDates: updated.blackoutDates,
    },
    ip: req.headers.get('x-forwarded-for') ?? '0.0.0.0',
  });

  return NextResponse.json({
    data: {
      timezone: updated.timezone,
      startTime: updated.startTime ?? null,
      endTime: updated.endTime ?? null,
      blackoutDates: updated.blackoutDates ?? [],
    },
  });
}, ['admin', 'user']);
