import 'dotenv/config';
import { Redis } from 'ioredis';
import { connectDb } from './lib/db.js';
import { logger } from './lib/logger.js';
import { AriWebSocket } from './ari/ariWebSocket.js';
import { AriEventRouter } from './ari/eventRouter.js';
import { CallDecisionEngine } from './engines/callDecisionEngine.js';
import { RealtimeGateway } from './gateway/realtimeGateway.js';
import { AriClient } from './services/ariClient.js';

// ---- Validate required environment variables ----------------------------

const REQUIRED_ENV = ['MONGODB_URI', 'REDIS_HOST', 'ARI_HOST', 'ARI_USERNAME', 'ARI_PASSWORD'];
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
  maxRetriesPerRequest: null,
  retryStrategy: (times) => Math.min(times * 500, 5000),
});

redis.on('connect', () => logger.info('Redis connected (listener)'));
redis.on('error', (err) => logger.error({ err }, 'Redis error (listener)'));

// ---- Graceful shutdown ---------------------------------------------------

let ariWs: AriWebSocket | null = null;

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Graceful shutdown initiated (listener)');
  ariWs?.destroy();
  await redis.quit();
  logger.info('Listener service shut down cleanly');
  process.exit(0);
}

// ---- Entry point ---------------------------------------------------------

async function main(): Promise<void> {
  logger.info('ARI listener service starting...');

  await connectDb();

  // Boot realtime gateway (Socket.IO)
  const gateway = new RealtimeGateway();

  // Create decision engine
  const engine = new CallDecisionEngine(redis, gateway);

  // Create ARI event router
  const router = new AriEventRouter(engine);

  // Connect ARI WebSocket
  ariWs = new AriWebSocket();

  ariWs.on('event', (event) => {
    void router.route(event);
  });

  ariWs.on('connected', () => {
    logger.info('ARI WebSocket connection established');

    // ISSUE-14: Reconcile in-flight calls after reconnect.
    // Any channel context still in Redis but no longer alive in Asterisk must be finalized.
    void (async () => {
      try {
        const ariHttp = new AriClient();
        const activeChannels = await ariHttp.listChannels();
        const activeIds = new Set(activeChannels.map((c) => c.id));

        const keys = await redis.keys('channel:*');
        for (const key of keys) {
          const channelId = key.replace('channel:', '');
          if (!activeIds.has(channelId)) {
            logger.warn({ channelId }, 'Reconcile: channel gone during ARI disconnect — finalizing');
            // Synthesize a ChannelDestroyed event for orphaned channel
            await engine.onChannelDestroyed({
              type: 'ChannelDestroyed',
              timestamp: new Date().toISOString(),
              application: process.env['ARI_APP_NAME'] ?? 'dialer',
              channel: { id: channelId, name: '', state: 'Down', caller: { number: '' } } as never,
            });
          }
        }
      } catch (err) {
        logger.error({ err }, 'ARI reconnect reconciliation failed');
      }
    })();
  });

  ariWs.on('disconnected', () => {
    logger.warn('ARI WebSocket disconnected');
  });

  ariWs.connect();

  // Signal handlers
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, () => void shutdown(signal));
  }

  process.on('uncaughtException', (err) => {
    logger.error({ err }, 'Uncaught exception (listener)');
    void shutdown('uncaughtException');
  });

  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Unhandled rejection (listener)');
  });

  logger.info(
    {
      ariHost: process.env['ARI_HOST'],
      gatewayPort: process.env['GATEWAY_PORT'] ?? '3001',
    },
    'ARI listener service started',
  );
}

main().catch((err) => {
  logger.error({ err }, 'Fatal startup error (listener)');
  process.exit(1);
});
