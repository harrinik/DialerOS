import { NextResponse, type NextRequest } from 'next/server';
import mongoose from 'mongoose';
import { connectDb } from '@/lib/db/connection';
import { CallLog } from '@/lib/db/models/CallLog';
import { withAuth } from '@/lib/auth/rbac';
import type { JwtPayload } from '@/lib/auth/jwt';

// GET /api/call-logs?campaignId=&disposition=&page=&limit=
export const GET = withAuth(async (req: NextRequest, user: JwtPayload) => {
  await connectDb();
  const { searchParams } = new URL(req.url);

  const filter: Record<string, unknown> = {};

  const campaignId = searchParams.get('campaignId');
  if (campaignId) {
    try { filter['campaignId'] = new mongoose.Types.ObjectId(campaignId); }
    catch { return NextResponse.json({ error: 'Invalid campaignId' }, { status: 400 }); }
  }

  const disposition = searchParams.get('disposition');
  if (disposition) filter['disposition'] = disposition;

  const page  = Math.max(1, Number(searchParams.get('page')  ?? 1));
  const limit = Math.min(Number(searchParams.get('limit') ?? 50), 200);
  const skip  = (page - 1) * limit;

  const [data, total] = await Promise.all([
    CallLog.find(filter)
      .sort({ startTime: -1 })
      .skip(skip)
      .limit(limit)
      .populate('contactId', 'phone firstName lastName')
      .populate('routedToAgentId', 'name extension')
      .lean(),
    CallLog.countDocuments(filter),
  ]);

  const normalized = data.map((entry) => {
    const contact = entry.contactId as { phone?: string; firstName?: string; lastName?: string } | undefined;
    const agent = entry.routedToAgentId as { name?: string; extension?: string } | undefined;

    return {
      ...entry,
      phone: contact?.phone ?? '',
      contactName: [contact?.firstName, contact?.lastName].filter(Boolean).join(' '),
      routedAgent: agent
        ? {
            name: agent.name ?? '',
            extension: agent.extension ?? '',
          }
        : null,
    };
  });

  return NextResponse.json({ data: normalized, total, page, limit });
});
