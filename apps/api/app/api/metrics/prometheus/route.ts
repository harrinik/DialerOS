import { NextResponse, type NextRequest } from 'next/server';
import { connectDb } from '@/lib/db/connection';
import { Campaign } from '@/lib/db/models/Campaign';
import { CallLog } from '@/lib/db/models/CallLog';
import { Agent } from '@/lib/db/models/Agent';
import { getRedisClient } from '@/lib/queue';

export const dynamic = 'force-dynamic';

function formatMetric(name: string, value: number, labels: Record<string, string> = {}): string {
  const labelStr = Object.entries(labels).map(([k, v]) => `${k}="${v}"`).join(',');
  return `${name}{${labelStr}} ${value}`;
}

export const GET = async (_req: NextRequest) => {
  await connectDb();
  const redis = getRedisClient();
  const lines: string[] = [];

  try {
    // Campaign metrics
    const campaigns = await Campaign.find({}, { name: 1, status: 1, stats: 1 }).lean();
    for (const camp of campaigns) {
      const stats = camp.stats as Record<string, number> | undefined;
      const labels = {
        campaign_id: String(camp._id),
        campaign_name: (camp.name ?? '').replace(/"/g, '\\"'),
      };

      lines.push(formatMetric('dialer_campaign_status', camp.status === 'running' ? 1 : 0, { ...labels, status: 'running' }));
      lines.push(formatMetric('dialer_campaign_status', camp.status === 'paused' ? 1 : 0, { ...labels, status: 'paused' }));
      lines.push(formatMetric('dialer_campaign_status', camp.status === 'draft' ? 1 : 0, { ...labels, status: 'draft' }));

      if (stats) {
        lines.push(formatMetric('dialer_campaign_contacts_total', stats.totalContacts ?? 0, labels));
        lines.push(formatMetric('dialer_campaign_dialed_total', stats.dialed ?? 0, labels));
        lines.push(formatMetric('dialer_campaign_answered_total', stats.answered ?? 0, labels));
        lines.push(formatMetric('dialer_campaign_failed_total', stats.failed ?? 0, labels));
        lines.push(formatMetric('dialer_campaign_active_calls', stats.active ?? 0, labels));
      }
    }

    // Agent metrics
    const agents = await Agent.find({}, { name: 1, status: 1, extension: 1 }).lean();
    for (const agent of agents) {
      const labels = {
        agent_id: String(agent._id),
        agent_name: (agent.name ?? '').replace(/"/g, '\\"'),
        agent_extension: agent.extension ?? '',
      };
      lines.push(formatMetric('dialer_agent_status', agent.status === 'available' ? 1 : 0, { ...labels, status: 'available' }));
      lines.push(formatMetric('dialer_agent_status', agent.status === 'busy' ? 1 : 0, { ...labels, status: 'busy' }));
      lines.push(formatMetric('dialer_agent_status', agent.status === 'offline' ? 1 : 0, { ...labels, status: 'offline' }));
      lines.push(formatMetric('dialer_agent_status', agent.status === 'wrapup' ? 1 : 0, { ...labels, status: 'wrapup' }));
    }

    // Queue metrics from Redis
    const queueKeys = await redis.keys('bull:*');
    for (const key of queueKeys) {
      const [, queueName, metric] = key.split(':');
      if (metric === 'waiting' || metric === 'active' || metric === 'completed' || metric === 'failed') {
        const value = Number(await redis.get(key) ?? 0);
        lines.push(formatMetric(`dialer_queue_${metric}`, value, { queue: queueName ?? 'unknown' }));
      }
    }

    // Pacing metrics
    const pacingKeys = await redis.keys('pacing:*');
    for (const key of pacingKeys) {
      const [, metric, campaignId] = key.split(':');
      if (metric === 'governor') {
        const data = await redis.get(key);
        if (data) {
          lines.push(formatMetric('dialer_pacing_governor_active', 1, { campaign_id: campaignId ?? 'unknown', reason: 'abandon_rate' }));
        }
      }
    }

    // Worker heartbeat
    const workerKeys = await redis.keys('worker:heartbeat:*');
    lines.push(formatMetric('dialer_workers_active', workerKeys.length));

  } catch (err) {
    lines.push(`# Error: ${String(err)}`);
  }

  return new NextResponse(lines.join('\n') + '\n', {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
};
