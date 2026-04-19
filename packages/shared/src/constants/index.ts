// BullMQ queue names
export const QUEUE_NAMES = {
  DIALER_CALLS: 'dialer-calls',
  DIALER_RETRY: 'dialer-retry',
  DIALER_DLQ:   'dialer-dlq',
} as const;

// BullMQ job names
export const JOB_NAMES = {
  ORIGINATE_CALL: 'originate_call',
  RETRY_CALL: 'retry_call',
} as const;

// Redis key prefixes
export const REDIS_KEYS = {
  DNC_SET: 'dnc:numbers',
  CAMPAIGN_SEMAPHORE: (campaignId: string) => `semaphore:campaign:${campaignId}`,
  CAMPAIGN_ACTIVE_CALLS: (campaignId: string) => `active_calls:${campaignId}`,
  CAMPAIGN_PACING: (campaignId: string) => `pacing:${campaignId}`,
  CHANNEL_CONTEXT: (channelId: string) => `channel:${channelId}`,
  AGENT_STATUS: (agentId: string) => `agent:status:${agentId}`,
  ANSWER_RATE_WINDOW: (campaignId: string) => `answer_rate:${campaignId}`,
  WORKER_HEARTBEAT: (workerId: string) => `worker:heartbeat:${workerId}`,
} as const;

// Socket.IO event names
export const SOCKET_EVENTS = {
  // Call events
  CALL_STARTED: 'call:started',
  CALL_RINGING: 'call:ringing',
  CALL_ANSWERED: 'call:answered',
  CALL_MACHINE: 'call:machine',
  CALL_HUMAN: 'call:human',
  CALL_DTMF: 'call:dtmf',
  CALL_ROUTED: 'call:routed',
  CALL_ENDED: 'call:ended',
  CALL_FAILED: 'call:failed',
  // Campaign events
  CAMPAIGN_STATS: 'campaign:stats',
  CAMPAIGN_STATUS_CHANGED: 'campaign:status_changed',
  // Agent events
  AGENT_STATUS_CHANGED: 'agent:status',
  // System
  ERROR: 'error',
} as const;

// Socket.IO rooms
export const SOCKET_ROOMS = {
  GLOBAL: 'global',
  CAMPAIGN: (campaignId: string) => `campaign:${campaignId}`,
  AGENT: (agentId: string) => `agent:${agentId}`,
} as const;

// ISSUE-04 fix: was a static constant evaluated at module load (baked into Docker image at build time).
// Now a function — evaluated at runtime so it respects the actual env var value.
export function getAriAppName(): string {
  return process.env['ARI_APP_NAME'] ?? 'dialer';
}
// Keep a const alias for any consumer that still reads it synchronously at module init
export const ARI_APP_NAME = 'dialer'; // fallback — prefer getAriAppName()

// Default values
export const DEFAULTS = {
  CONCURRENCY: 5,
  RATE_PER_SECOND: 1,
  RETRY_BACKOFF_BASE_MS: 1000,
  RETRY_BACKOFF_MAX_MS: 60_000,
  ARI_RECONNECT_INITIAL_MS: 1000,
  ARI_RECONNECT_MAX_MS: 60_000,
  PACING_TARGET_OCCUPANCY: 0.85,
  PACING_ANSWER_RATE_WINDOW_SECONDS: 300,
  DTMF_TIMEOUT_SECONDS: 5,
  DTMF_INTER_DIGIT_TIMEOUT_SECONDS: 2,
  MAX_CALL_DURATION_SECONDS: 3600, // 1 hour hard guard
} as const;

// Call disposition → retry eligibility
export const RETRYABLE_DISPOSITIONS = new Set([
  'no_answer',
  'busy',
  'failed',
]);

// HTTP status codes for ARI responses
export const ARI_HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  NOT_FOUND: 404,
  CONFLICT: 409,
} as const;
