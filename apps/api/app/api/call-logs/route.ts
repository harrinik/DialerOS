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

  // Phone filter: match on the populated contact's phone field
  const phoneSearch = searchParams.get('phone');

  const page  = Math.max(1, Number(searchParams.get('page')  ?? 1));
  const limit = Math.min(Number(searchParams.get('limit') ?? 50), 200);
  const skip  = (page - 1) * limit;

  // If phone filter is set, use aggregation to join contacts
  if (phoneSearch) {
    const pipeline = [
      { $match: filter },
      { $sort: { startTime: -1 as const } },
      { $lookup: { from: 'contacts', localField: 'contactId', foreignField: '_id', as: '_contact' } },
      { $addFields: { _phone: { $ifNull: [{ $arrayElemAt: ['$_contact.phone', 0] }, ''] } } },
      { $match: { _phone: { $regex: phoneSearch, $options: 'i' } } },
    ];
    const [rows, countResult] = await Promise.all([
      CallLog.aggregate([...pipeline, { $skip: skip }, { $limit: limit },
        { $lookup: { from: 'contacts', localField: 'contactId', foreignField: '_id', as: '_contact' } },
        { $lookup: { from: 'agents',   localField: 'routedToAgentId', foreignField: '_id', as: '_agent' } },
      ]),
      CallLog.aggregate([...pipeline, { $count: 'n' }]),
    ]);
    const totalCount = (countResult[0] as { n?: number } | undefined)?.n ?? 0;
    const normalized = rows.map((entry: Record<string, unknown>) => {
      const contacts = entry['_contact'] as Array<{ phone?: string; firstName?: string; lastName?: string }>;
      const agents   = entry['_agent'] as Array<{ name?: string; extension?: string }>;
      const contact = contacts?.[0];
      const agent   = agents?.[0];
      return {
        ...entry,
        phone: contact?.phone ?? '',
        contactName: [contact?.firstName, contact?.lastName].filter(Boolean).join(' '),
        routedAgent: agent ? { name: agent.name ?? '', extension: agent.extension ?? '' } : null,
        _contact: undefined,
        _agent: undefined,
        _phone: undefined,
      };
    });
    return NextResponse.json({ data: normalized, total: totalCount, page, limit });
  }

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
