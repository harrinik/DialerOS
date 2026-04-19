import { NextResponse, type NextRequest } from 'next/server';
import { connectDb } from '@/lib/db/connection';
import { CdrLog } from '@dialer/db';
import { withUser } from '@/lib/auth/rbac';
import type { JwtPayload } from '@/lib/auth/jwt';

/**
 * GET /api/cdr
 * Returns raw CDR records from the cdr_logs collection.
 * These cover ALL calls including internal extension-to-extension calls.
 *
 * Query params:
 *   page     (default 1)
 *   limit    (default 50, max 200)
 *   from     ISO date string
 *   to       ISO date string
 *   type     internal | outbound | inbound | campaign
 *   src      caller number filter (partial match)
 *   dst      destination filter (partial match)
 *   disposition ANSWERED | NO ANSWER | BUSY | FAILED | CONGESTION
 */
export const GET = withUser(async (req: NextRequest, _user: JwtPayload) => {
  await connectDb();

  const { searchParams } = new URL(req.url);
  const page   = Math.max(1, parseInt(searchParams.get('page') ?? '1'));
  const limit  = Math.min(200, parseInt(searchParams.get('limit') ?? '50'));
  const skip   = (page - 1) * limit;

  const filter: Record<string, unknown> = {};

  const from = searchParams.get('from');
  const to   = searchParams.get('to');
  if (from || to) {
    filter['startTime'] = {
      ...(from ? { $gte: new Date(from) } : {}),
      ...(to   ? { $lte: new Date(to)   } : {}),
    };
  }

  const type        = searchParams.get('type');
  const disposition = searchParams.get('disposition');
  const src         = searchParams.get('src');
  const dst         = searchParams.get('dst');

  if (type)        filter['type']        = type;
  if (disposition) filter['disposition'] = disposition;
  if (src)         filter['src']         = { $regex: src, $options: 'i' };
  if (dst)         filter['dst']         = { $regex: dst, $options: 'i' };

  const [records, total] = await Promise.all([
    CdrLog.find(filter).sort({ startTime: -1 }).skip(skip).limit(limit).lean(),
    CdrLog.countDocuments(filter),
  ]);

  // Summary stats for the filtered set
  const stats = await CdrLog.aggregate([
    { $match: filter },
    {
      $group: {
        _id: '$disposition',
        count:       { $sum: 1 },
        totalSecs:   { $sum: '$billableSeconds' },
        avgDuration: { $avg: '$duration' },
      },
    },
  ]);

  return NextResponse.json({
    records,
    total,
    page,
    pages: Math.ceil(total / limit),
    stats,
  });
});
