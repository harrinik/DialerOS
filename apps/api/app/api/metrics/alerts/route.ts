import { NextResponse, type NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth/rbac';
import type { JwtPayload } from '@/lib/auth/jwt';
import { getQueueMetrics, getRedisClient } from '@/lib/queue';

type AlertLevel = 'ok' | 'warn' | 'critical';

interface AlertItem {
  key: string;
  level: AlertLevel;
  message: string;
  value?: number | string;
}

function classify(value: number, warn: number, critical: number): AlertLevel {
  if (value >= critical) return 'critical';
  if (value >= warn) return 'warn';
  return 'ok';
}

export const GET = withAuth(async (_req: NextRequest, _user: JwtPayload) => {
  const redis = getRedisClient();
  const queueMetrics = await getQueueMetrics().catch(() => ({
    waiting: -1,
    active: -1,
    completed: -1,
    failed: -1,
    delayed: -1,
  }));

  const alerts: AlertItem[] = [];
  if (queueMetrics.waiting < 0) {
    alerts.push({
      key: 'queue.unavailable',
      level: 'critical',
      message: 'Queue metrics unavailable (Redis or queue connection failure).',
    });
  } else {
    alerts.push({
      key: 'queue.waiting',
      level: classify(queueMetrics.waiting, 500, 2000),
      message: 'Waiting queue depth',
      value: queueMetrics.waiting,
    });
    alerts.push({
      key: 'queue.failed',
      level: classify(queueMetrics.failed, 50, 300),
      message: 'Failed jobs in queue',
      value: queueMetrics.failed,
    });
  }

  const heartbeatKeys = await redis.keys('worker:heartbeat:*').catch(() => []);
  alerts.push({
    key: 'worker.heartbeats',
    level: heartbeatKeys.length === 0 ? 'critical' : heartbeatKeys.length < 2 ? 'warn' : 'ok',
    message: 'Active worker heartbeats',
    value: heartbeatKeys.length,
  });

  const governorKeys = await redis.keys('pacing:governor:*').catch(() => []);
  alerts.push({
    key: 'pacing.governor_active',
    level: governorKeys.length > 5 ? 'critical' : governorKeys.length > 0 ? 'warn' : 'ok',
    message: 'Campaigns currently throttled by governor',
    value: governorKeys.length,
  });

  const overall = alerts.some((alert) => alert.level === 'critical')
    ? 'critical'
    : alerts.some((alert) => alert.level === 'warn')
      ? 'warn'
      : 'ok';

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    overall,
    alerts,
  });
}, ['admin', 'user']);
