import { NextResponse, type NextRequest } from 'next/server';
import { connectDb } from '@/lib/db/connection';
import { HolidayCalendar, type IHolidayCalendar } from '@/lib/db/models/HolidayCalendar';
import { withAuth } from '@/lib/auth/rbac';
import type { JwtPayload } from '@/lib/auth/jwt';

export const GET = withAuth(async (_req: NextRequest, user: JwtPayload) => {
  await connectDb();
  const calendars = await HolidayCalendar.find({ ownerId: user.sub }).sort({ name: 1 }).lean();
  return NextResponse.json({ data: calendars });
});

export const POST = withAuth(async (req: NextRequest, user: JwtPayload) => {
  await connectDb();
  const body = await req.json() as Record<string, unknown>;

  const name = String(body['name'] ?? '').trim();
  const timezone = String(body['timezone'] ?? 'UTC');
  const dates = body['dates'] as Array<{ date: string; label: string }> | undefined;
  const isDefault = Boolean(body['isDefault']);

  if (!name) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }

  let calendar: IHolidayCalendar | null = null;

  if (isDefault) {
    await HolidayCalendar.updateMany({ ownerId: user.sub }, { $set: { isDefault: false } });
  }

  try {
    calendar = await HolidayCalendar.create({
      name,
      timezone,
      dates: dates ?? [],
      ownerId: user.sub,
      isDefault,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 });
  }

  return NextResponse.json({ data: calendar }, { status: 201 });
}, ['admin', 'user']);
