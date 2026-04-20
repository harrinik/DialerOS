import { NextResponse, type NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth/rbac';
import type { JwtPayload } from '@/lib/auth/jwt';
import { connectDb } from '@/lib/db/connection';
import { Campaign } from '@/lib/db/models/Campaign';
import { getRedisClient } from '@/lib/queue';

export const GET = withAuth(async (_req: NextRequest, user: JwtPayload) => {
  await connectDb();
  const redis = getRedisClient();

  const campaigns = await Campaign.find(
    user.role === 'admin' ? {} : { ownerId: user.sub },
    { name: 1, status: 1 },
  ).lean();

  const data = await Promise.all(
    campaigns.map(async (campaign) => {
      const campaignId = String(campaign._id);
      const [lastRateRaw, governorRaw, abandonRaw] = await Promise.all([
        redis.get(`pacing:last_rate:${campaignId}`),
        redis.get(`pacing:governor:${campaignId}`),
        redis.get(`pacing:abandon_rate:${campaignId}`),
      ]);

      let lastRate: Record<string, unknown> | null = null;
      let governor: Record<string, unknown> | null = null;
      try { lastRate = lastRateRaw ? JSON.parse(lastRateRaw) as Record<string, unknown> : null; } catch {}
      try { governor = governorRaw ? JSON.parse(governorRaw) as Record<string, unknown> : null; } catch {}

      return {
        campaignId,
        name: campaign.name,
        status: campaign.status,
        lastRate,
        governor,
        abandonProxyRate: abandonRaw ? Number.parseFloat(abandonRaw) : null,
      };
    }),
  );

  const workerHeartbeatKeys = await redis.keys('worker:heartbeat:*');
  const workerHeartbeatsRaw = workerHeartbeatKeys.length > 0
    ? await redis.mget(workerHeartbeatKeys)
    : [];
  const workers = workerHeartbeatsRaw
    .map((value, index) => {
      if (!value) return null;
      try {
        const parsed = JSON.parse(value) as { pid?: number; ts?: string };
        return { key: workerHeartbeatKeys[index], ...parsed };
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    campaigns: data,
    workers,
  });
}, ['admin', 'user']);
