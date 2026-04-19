import { NextResponse, type NextRequest } from 'next/server';
import mongoose from 'mongoose';
import { connectDb } from '@/lib/db/connection';
import { CallLog } from '@/lib/db/models/CallLog';
import { Campaign } from '@/lib/db/models/Campaign';
import { withAuth } from '@/lib/auth/rbac';
import { getQueueMetrics } from '@/lib/queue';
import type { JwtPayload } from '@/lib/auth/jwt';

/**
 * GET /api/reports
 * Returns aggregated call and campaign statistics.
 *
 * Query params:
 *   - campaignId (optional): filter by campaign
 *   - from / to (optional): ISO date range
 *   - granularity: 'hour' | 'day' | 'week' (default: 'day')
 */
export const GET = withAuth(async (req: NextRequest, user: JwtPayload) => {
  await connectDb();

  const { searchParams } = new URL(req.url);
  const campaignId = searchParams.get('campaignId');
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const granularity = (searchParams.get('granularity') ?? 'day') as
    | 'hour'
    | 'day'
    | 'week';

  // Base filter
  const matchFilter: Record<string, unknown> = {};
  if (campaignId) {
    try {
      matchFilter['campaignId'] = new mongoose.Types.ObjectId(campaignId);
    } catch {
      return NextResponse.json({ error: 'Invalid campaignId format' }, { status: 400 });
    }
  }
  if (from || to) {
    matchFilter['startTime'] = {
      ...(from ? { $gte: new Date(from) } : {}),
      ...(to ? { $lte: new Date(to) } : {}),
    };
  }

  // Date trunc format for $dateToString
  const dateFormat =
    granularity === 'hour'
      ? '%Y-%m-%dT%H:00:00'
      : granularity === 'week'
      ? '%Y-%U' // week of year
      : '%Y-%m-%d';

  // Aggregate call logs by time bucket
  const timeSeriesResult = await CallLog.aggregate([
    { $match: matchFilter },
    {
      $group: {
        _id: {
          bucket: {
            $dateToString: { format: dateFormat, date: '$startTime' },
          },
          disposition: '$disposition',
        },
        count: { $sum: 1 },
        totalDuration: { $sum: { $ifNull: ['$duration', 0] } },
      },
    },
    {
      $group: {
        _id: '$_id.bucket',
        dispositions: {
          $push: {
            disposition: '$_id.disposition',
            count: '$count',
            totalDuration: '$totalDuration',
          },
        },
        total: { $sum: '$count' },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  // Overall summary
  const summaryResult = await CallLog.aggregate([
    { $match: matchFilter },
    {
      $group: {
        _id: '$disposition',
        count: { $sum: 1 },
        avgDuration: { $avg: '$duration' },
        totalDuration: { $sum: { $ifNull: ['$duration', 0] } },
      },
    },
  ]);

  // AMD result breakdown
  const amdResult = await CallLog.aggregate([
    { $match: { ...matchFilter, amdResult: { $exists: true } } },
    { $group: { _id: '$amdResult', count: { $sum: 1 } } },
  ]);

  // Campaign summary (admin sees all, user sees own)
  const campaignFilter =
    user.role === 'admin' ? {} : { ownerId: user.sub };
  const campaigns = await Campaign.find(campaignFilter)
    .select('name status stats createdAt')
    .lean();

  // Queue metrics — Redis may not be available; return zeros gracefully
  let queueMetrics = { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 };
  try {
    queueMetrics = await getQueueMetrics();
  } catch {
    // Redis offline — dashboard will show zeros
  }

  return NextResponse.json({
    timeSeries: timeSeriesResult,
    summary: summaryResult,
    amdBreakdown: amdResult,
    campaigns,
    queueMetrics,
    generatedAt: new Date().toISOString(),
  });
});
