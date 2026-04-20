import { NextResponse, type NextRequest } from 'next/server';
import { connectDb } from '@/lib/db/connection';
import { CdrLog } from '@/lib/db/models/CdrLog';
import { withAuth } from '@/lib/auth/rbac';
import type { JwtPayload } from '@/lib/auth/jwt';

export const GET = withAuth(async (req: NextRequest, _user: JwtPayload) => {
  await connectDb();

  const { searchParams } = new URL(req.url);
  const days = Number(searchParams.get('days') ?? 7);
  const trunkPrefix = searchParams.get('trunk');

  const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const match: Record<string, unknown> = {
    startTime: { $gte: from },
  };

  if (trunkPrefix) {
    match['dst'] = { $regex: `^${trunkPrefix}` };
  }

  const pipeline = [
    { $match: match },
    {
      $group: {
        _id: '$dst',
        totalCalls: { $sum: 1 },
        answeredCalls: { $sum: { $cond: [{ $eq: ['$disposition', 'ANSWERED'] }, 1, 0] } },
        failedCalls: { $sum: { $cond: [{ $eq: ['$disposition', 'FAILED'] }, 1, 0] } },
        busyCalls: { $sum: { $cond: [{ $eq: ['$disposition', 'BUSY'] }, 1, 0] } },
        noAnswerCalls: { $sum: { $cond: [{ $eq: ['$disposition', 'NO ANSWER'] }, 1, 0] } },
        totalDuration: { $sum: '$duration' },
        avgDuration: { $avg: '$duration' },
        totalBillable: { $sum: '$billableSeconds' },
        avgPdd: { $avg: '$pdd' },
        maxPdd: { $max: '$pdd' },
      },
    },
    {
      $addFields: {
        asr: { $cond: [{ $eq: ['$totalCalls', 0] }, 0, { $multiply: [{ $divide: ['$answeredCalls', '$totalCalls'] }, 100] }] },
        acd: { $cond: [{ $eq: ['$answeredCalls', 0] }, 0, { $divide: ['$totalDuration', '$answeredCalls'] }] },
      },
    },
    { $sort: { totalCalls: -1 } },
  ];

  const results = await CdrLog.aggregate(pipeline);

  const data = results.map((r) => ({
    trunk: r._id ?? 'unknown',
    totalCalls: r.totalCalls,
    answeredCalls: r.answeredCalls,
    failedCalls: r.failedCalls,
    busyCalls: r.busyCalls,
    noAnswerCalls: r.noAnswerCalls,
    asr: Number(r.asr?.toFixed(2) ?? 0),
    acd: Number(r.acd?.toFixed(2) ?? 0),
    avgDuration: Number(r.avgDuration?.toFixed(0) ?? 0),
    totalDuration: r.totalDuration ?? 0,
    avgPdd: Number(r.avgPdd?.toFixed(2) ?? 0),
    maxPdd: r.maxPdd ?? 0,
  }));

  return NextResponse.json({ data });
}, ['admin', 'user']);