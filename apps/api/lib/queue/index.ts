import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { QUEUE_NAMES, JOB_NAMES, type DialJobPayload } from '@dialer/shared';

// Singleton Redis connection for the API service
let redis: Redis | null = null;

function getRedis(): Redis {
  if (!redis) {
    redis = new Redis({
      host: process.env['REDIS_HOST'] ?? 'localhost',
      port: parseInt(process.env['REDIS_PORT'] ?? '6379', 10),
      password: process.env['REDIS_PASSWORD'] || undefined,
      maxRetriesPerRequest: null,
      lazyConnect: true,
      retryStrategy: (times) => Math.min(times * 500, 5000),
    });
  }
  return redis;
}

export function getRedisClient(): Redis {
  return getRedis();
}

// Queue instances (cached)
let dialQueue: Queue<DialJobPayload> | null = null;

export function getDialQueue(): Queue<DialJobPayload> {
  if (!dialQueue) {
    dialQueue = new Queue<DialJobPayload>(QUEUE_NAMES.DIALER_CALLS, {
      connection: getRedis(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 5000 },
      },
    });
  }
  return dialQueue;
}

/**
 * Add a single dial job to the queue.
 */
export async function enqueueDialJob(
  payload: DialJobPayload,
  options?: { delay?: number; priority?: number },
): Promise<string | undefined> {
  const queue = getDialQueue();
  const job = await queue.add(JOB_NAMES.ORIGINATE_CALL, payload, {
    ...(options?.delay !== undefined    && { delay:    options.delay }),
    ...(options?.priority !== undefined && { priority: options.priority }),
    jobId: `dial-${payload.contactId}-${payload.attempt}`,
  });
  return job.id;
}

/**
 * Bulk enqueue dial jobs using pipeline for efficiency.
 */
export async function bulkEnqueueDialJobs(
  payloads: DialJobPayload[],
): Promise<void> {
  const queue = getDialQueue();
  const jobs = payloads.map((p) => ({
    name: JOB_NAMES.ORIGINATE_CALL,
    data: p,
    opts: {
      jobId: `dial-${p.contactId}-${p.attempt}`,
      priority: 1,
    },
  }));
  await queue.addBulk(jobs);
}

/**
 * Get queue metrics for the dashboard.
 */
export async function getQueueMetrics(): Promise<{
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}> {
  const queue = getDialQueue();
  const counts = await queue.getJobCounts(
    'waiting',
    'active',
    'completed',
    'failed',
    'delayed',
  );
  return counts as {
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  };
}

export async function replayFailedDialJobs(limit = 100): Promise<{
  requested: number;
  replayed: number;
  failedIds: string[];
}> {
  const queue = getDialQueue();
  const safeLimit = Math.min(Math.max(limit, 1), 500);
  const failedJobs = await queue.getFailed(0, safeLimit - 1);
  const failedIds: string[] = [];
  let replayed = 0;

  await Promise.all(
    failedJobs.map(async (job) => {
      try {
        await job.retry();
        replayed += 1;
      } catch {
        failedIds.push(String(job.id));
      }
    }),
  );

  return { requested: safeLimit, replayed, failedIds };
}
