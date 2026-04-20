import { NextResponse, type NextRequest } from 'next/server';
import { connectDb } from '@/lib/db/connection';
import { HolidayCalendar } from '@/lib/db/models/HolidayCalendar';
import { withAuth } from '@/lib/auth/rbac';
import type { JwtPayload } from '@/lib/auth/jwt';

type RouteParams = { params: { id: string } };

export const GET = withAuth(async (_req: NextRequest, user: JwtPayload, { params }: RouteParams) => {
  await connectDb();
  const calendar = await HolidayCalendar.findOne({ _id: params.id, ownerId: user.sub }).lean();
  if (!calendar) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ data: calendar });
});

export const PATCH = withAuth(async (req: NextRequest, user: JwtPayload, { params }: RouteParams) => {
  await connectDb();
  const calendar = await HolidayCalendar.findOne({ _id: params.id, ownerId: user.sub });
  if (!calendar) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json() as Record<string, unknown>;

  if (body['name']) calendar.name = String(body['name']).trim();
  if (body['timezone']) calendar.timezone = String(body['timezone']);
  if (Array.isArray(body['dates'])) calendar.dates = body['dates'] as Array<{ date: string; label: string }>;

  if (Boolean(body['isDefault'])) {
    await HolidayCalendar.updateMany({ ownerId: user.sub, _id: { $ne: calendar._id } }, { $set: { isDefault: false } });
    calendar.isDefault = true;
  }

  await calendar.save();
  return NextResponse.json({ data: calendar });
});

export const DELETE = withAuth(async (_req: NextRequest, user: JwtPayload, { params }: RouteParams) => {
  await connectDb();
  const result = await HolidayCalendar.deleteOne({ _id: params.id, ownerId: user.sub });
  if (result.deletedCount === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ message: 'Deleted' });
}, ['admin', 'user']);