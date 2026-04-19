import 'dotenv/config';
import { Redis } from 'ioredis';
import { Queue } from 'bullmq';
import { QUEUE_NAMES, REDIS_KEYS } from '@dialer/shared';
import { DncList } from '@dialer/db';
import { connectDb } from './lib/db.js';
import { logger } from './lib/logger.js';
import { createDialerWorker } from './workers/dialerWorker.js';
import { createRetryWorker } from './workers/retryWorker.js';

// ---- Validate required environment variables ----------------------------

const REQUIRED_ENV = [
  'MONGODB_URI',
  'REDIS_HOST',
  'ARI_HOST',
  'ARI_USERNAME',
  'ARI_PASSWORD',
];

for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    logger.error({ key }, 'Required environment variable is missing');
    process.exit(1);
  }
}

// ---- Redis connection ----------------------------------------------------

const redis = new Redis({
  host: process.env['REDIS_HOST'] ?? 'localhost',
  port: parseInt(process.env['REDIS_PORT'] ?? '6379', 10),
  password: process.env['REDIS_PASSWORD'] || undefined,
  maxRetriesPerRequest: null, // Required for BullMQ
  enableReadyCheck: false,
  retryStrategy: (times) => Math.min(times * 500, 5000),
});

redis.on('connect', () => logger.info('Redis connected'));
redis.on('error', (err) => logger.error({ err }, 'Redis error'));
redis.on('reconnecting', () => logger.warn('Redis reconnecting...'));

// ---- Dead-letter queue listener -----------------------------------------

function setupDlqMonitor(redisConnection: Redis): void {
  const dlqQueue = new Queue(QUEUE_NAMES.DIALER_DLQ, {
    connection: redisConnection,
  });

  // Periodically log DLQ stats
  setInterval(async () => {
    const counts = await dlqQueue.getJobCounts('failed', 'completed');
    if ((counts.failed ?? 0) > 0) {
      logger.warn({ dlqCounts: counts }, 'DLQ has failed jobs');
    }
  }, 60_000);
}

// ---- Graceful shutdown ---------------------------------------------------

let isShuttingDown = false;

async function shutdown(
  signal: string,
  workers: Array<{ close(): Promise<void> }>,
): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info({ signal }, 'Graceful shutdown initiated');

  // Give workers up to 30s to finish current jobs
  await Promise.all(workers.map((w) => w.close()));
  await redis.quit();

  logger.info('Worker service shut down cleanly');
  process.exit(0);
}

// ---- Entry point ---------------------------------------------------------

async function main(): Promise<void> {
  logger.info('Dialer worker service starting...');

  // Connect to MongoDB
  await connectDb();

  // ISSUE-24: Sync DNC list from MongoDB to Redis on startup
  // Prevents dialing DNC numbers immediately after a Redis restart
  try {
    const dncEntries = await DncList.find({}, 'phone').lean();
    if (dncEntries.length > 0) {
      const phones = dncEntries.map((e) => e.phone as string).filter(Boolean);
      if (phones.length > 0) {
        await redis.sadd(REDIS_KEYS.DNC_SET, ...phones);
      }
      logger.info({ count: dncEntries.length }, 'DNC list synced to Redis');
    }
  } catch (err) {
    logger.error({ err }, 'DNC sync failed — continuing (calls may reach DNC numbers)');
  }

  // Start BullMQ workers
  const dialerWorker = createDialerWorker(redis);
  const retryWorker = createRetryWorker(redis);

  // DLQ monitoring
  setupDlqMonitor(redis);

  const workers = [dialerWorker, retryWorker];

  // Declare workerId BEFORE the heartbeat interval
  const workerId = `worker-${process.pid}-${Date.now()}`;

  // ISSUE-26: catch heartbeat write failures to prevent unhandled rejections crashing the worker
  setInterval(() => {
    redis
      .setex(`worker:heartbeat:${workerId}`, 30, JSON.stringify({ pid: process.pid, ts: new Date().toISOString() }))
      .catch((err) => logger.warn({ err }, 'Heartbeat write failed (non-fatal)'));
  }, 10_000);

  // Signal handlers
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, () => void shutdown(signal, workers));
  }

  process.on('uncaughtException', (err) => {
    logger.error({ err }, 'Uncaught exception');
    void shutdown('uncaughtException', workers);
  });

  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Unhandled promise rejection');
  });

  logger.info(
    {
      concurrency: process.env['WORKER_CONCURRENCY'] ?? '10',
      ariHost: process.env['ARI_HOST'],
    },
    'Dialer worker service started',
  );
}

main().catch((err) => {
  logger.error({ err }, 'Fatal startup error');
  process.exit(1);
});
