/**
 * Dialer Worker
 *
 * Fixes applied:
 *   ISSUE-01: Stall handler releases concurrency slot + decrements stats.active
 *   ISSUE-02: Concurrency limit stored IN Redis so replicas share single truth
 *   ISSUE-05: Uses canonical @dialer/db models (no inline schema)
 *   ISSUE-08: moveToDelayed + throw DelayedError (prevents silent job loss)
 *   ISSUE-13: Duplicate channelId key error handled explicitly
 *   ISSUE-25: stats.active clamped at 0 via aggregation pipeline
 */

import {
  Worker,
  Job,
  type WorkerOptions,
  UnrecoverableError,
  DelayedError,
} from 'bullmq';
import type { Redis } from 'ioredis';
import { v4 as uuidv4 } from 'uuid';
import {
  QUEUE_NAMES,
  JOB_NAMES,
  REDIS_KEYS,
  type DialJobPayload,
} from '@dialer/shared';
import { CallLog, Contact, Campaign, Agent, HolidayCalendar } from '@dialer/db';
import { AriClient } from '../services/ariClient.js';
import { DncService } from '../services/dncService.js';
import { ConcurrencyManager } from '../services/concurrencyManager.js';
import { ErlangCPacingService } from '../services/pacingService.js';
import { logger } from '../lib/logger.js';

type TraceLevel = 'info' | 'success' | 'warning' | 'error';

async function appendCallTrace(
  callLogId: string,
  step: string,
  level: TraceLevel,
  title: string,
  detail?: string,
): Promise<void> {
  await CallLog.updateOne(
    { _id: callLogId },
    {
      $push: {
        trace: {
          at: new Date(),
          step,
          level,
          title,
          ...(detail ? { detail } : {}),
        },
      },
    },
  );
}

async function markCallFailure(
  callLogId: string,
  stage: string,
  reason: string,
  detail?: string,
): Promise<void> {
  await CallLog.updateOne(
    { _id: callLogId },
    {
      $set: {
        disposition: 'failed',
        endTime: new Date(),
        retryable: true,
        notes: reason,
        failureStage: stage,
        failureReason: reason,
      },
      $push: {
        trace: {
          at: new Date(),
          step: stage,
          level: 'error',
          title: 'Call failed',
          detail: detail ?? reason,
        },
      },
    },
  );
}

/** Atomically clamp stats.active at 0 — prevents negative values (ISSUE-25) */
async function decrementActiveClamp(campaignId: string): Promise<void> {
  await Campaign.updateOne(
    { _id: campaignId },
    [{ $set: { 'stats.active': { $max: [{ $subtract: ['$stats.active', 1] }, 0] } } }],
  );
}

function parseTimeToMinutes(time: string): number {
  const parts = time.split(':');
  const h = Number.parseInt(parts[0] ?? '', 10);
  const m = Number.parseInt(parts[1] ?? '', 10);
  if (!Number.isInteger(h) || !Number.isInteger(m)) return -1;
  return h * 60 + m;
}

function getCurrentMinutesInTimezone(timezone: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date());
    const hour = Number.parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10);
    const minute = Number.parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10);
    return hour * 60 + minute;
  } catch {
    const now = new Date();
    return now.getUTCHours() * 60 + now.getUTCMinutes();
  }
}

function getCurrentDateInTimezone(timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  } catch {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  }
}

const ABANDON_WINDOW_MINUTES = Number.parseInt(process.env['PACING_ABANDON_WINDOW_MINUTES'] ?? '30', 10);
const ABANDON_CACHE_SECONDS = Number.parseInt(process.env['PACING_ABANDON_CACHE_SECONDS'] ?? '60', 10);
const ABANDON_MAX_RATE = Number.parseFloat(process.env['PACING_ABANDON_MAX_RATE'] ?? '0.03');
const CAMPAIGN_LEASE_MS = Number.parseInt(process.env['WORKER_CAMPAIGN_LEASE_MS'] ?? '5000', 10);
const INFLIGHT_LOCK_SECONDS = Number.parseInt(process.env['WORKER_INFLIGHT_LOCK_SECONDS'] ?? '180', 10);

async function getAbandonProxyRate(redis: Redis, campaignId: string): Promise<number> {
  const key = `pacing:abandon_rate:${campaignId}`;
  const cached = await redis.get(key);
  if (cached) {
    const parsed = Number.parseFloat(cached);
    if (Number.isFinite(parsed)) return parsed;
  }

  const from = new Date(Date.now() - ABANDON_WINDOW_MINUTES * 60 * 1000);
  const [total, problematic] = await Promise.all([
    CallLog.countDocuments({ campaignId, startTime: { $gte: from } }),
    CallLog.countDocuments({
      campaignId,
      startTime: { $gte: from },
      disposition: { $in: ['failed', 'cancelled', 'no_answer'] },
    }),
  ]);

  // Avoid noisy decisions with tiny sample sizes
  if (total < 20) {
    await redis.set(key, '0', 'EX', ABANDON_CACHE_SECONDS);
    return 0;
  }

  const rate = problematic / total;
  await redis.set(key, rate.toFixed(6), 'EX', ABANDON_CACHE_SECONDS);
  return rate;
}

async function releaseOwnedKey(redis: Redis, key: string, owner: string): Promise<void> {
  const lua = `
    if redis.call('GET', KEYS[1]) == ARGV[1] then
      return redis.call('DEL', KEYS[1])
    end
    return 0
  `;
  await redis.eval(lua, 1, key, owner);
}

function getDelayUntilDialWindow(timezone: string, startTime?: string, endTime?: string): number | null {
  if (!startTime || !endTime) return null;
  const start = parseTimeToMinutes(startTime);
  const end = parseTimeToMinutes(endTime);
  if (start < 0 || end < 0) return null;

  const current = getCurrentMinutesInTimezone(timezone);

  // Standard day window, e.g. 09:00 - 18:00
  if (start <= end) {
    const inWindow = current >= start && current < end;
    if (inWindow) return null;
    const minutesUntilStart = current < start ? start - current : (24 * 60 - current) + start;
    return minutesUntilStart * 60 * 1000;
  }

  // Overnight window, e.g. 22:00 - 06:00
  const inOvernightWindow = current >= start || current < end;
  if (inOvernightWindow) return null;
  const minutesUntilOvernightStart = start - current;
  return Math.max(minutesUntilOvernightStart, 0) * 60 * 1000;
}

export function createDialerWorker(redis: Redis): Worker {
  const ari = new AriClient();
  const dnc = new DncService(redis);
  const concurrency = new ConcurrencyManager(redis);
  const pacing = new ErlangCPacingService(redis);

  const workerOptions: WorkerOptions = {
    connection: redis,
    concurrency: parseInt(process.env['WORKER_CONCURRENCY'] ?? '10', 10),
    limiter: {
      max: parseInt(process.env['WORKER_RATE_LIMIT_MAX'] ?? '10', 10),
      duration: parseInt(process.env['WORKER_RATE_LIMIT_DURATION'] ?? '1000', 10),
    },
  };

  const worker = new Worker<DialJobPayload>(
    QUEUE_NAMES.DIALER_CALLS,
    async (job: Job<DialJobPayload>) => {
      const {
        contactId, campaignId, phone, callerIdName, callerIdNumber,
        sipTrunk, concurrencyLimit, amdAction, ivrFlowId, attempt,
      } = job.data;

      const jobLog = logger.child({ jobId: job.id, contactId, campaignId, phone, attempt });
      jobLog.info('Dialer job started');
      const lockOwner = `${process.pid}:${Date.now()}:${job.id}`;
      const leaseKey = `dialer:lease:${campaignId}`;
      const inflightKey = `dialer:inflight:${campaignId}:${contactId}:${attempt}`;
      let leaseAcquired = false;
      let inflightAcquired = false;

      try {
        // 0. Campaign lease lock (serialize campaign dispatch across replicas)
        const leaseResult = await redis.set(leaseKey, lockOwner, 'PX', CAMPAIGN_LEASE_MS, 'NX');
        if (leaseResult !== 'OK') {
          await job.moveToDelayed(Date.now() + 700, job.token);
          throw new DelayedError();
        }
        leaseAcquired = true;

        // 0b. Contact attempt in-flight idempotency lock
        const inflightResult = await redis.set(inflightKey, lockOwner, 'EX', INFLIGHT_LOCK_SECONDS, 'NX');
        if (inflightResult !== 'OK') {
          jobLog.debug('Duplicate in-flight attempt detected — delaying');
          await job.moveToDelayed(Date.now() + 2000, job.token);
          throw new DelayedError();
        }
        inflightAcquired = true;

        // 0c. Contact status guard for idempotency safety
        const contact = await Contact.findById(contactId, { status: 1 }).lean();
        if (!contact) {
          throw new UnrecoverableError(`Contact ${contactId} not found`);
        }
        if (!['pending', 'retry_scheduled'].includes(String(contact.status))) {
          jobLog.info({ status: contact.status }, 'Contact already processed/in progress — skipping');
          return;
        }

        // 1. DNC check
        const isBlocked = await dnc.isBlocked(phone);
        if (isBlocked) {
          jobLog.info('Contact on DNC — skipping');
          await Contact.updateOne({ _id: contactId }, { $set: { status: 'dnc' } });
          return;
        }

        // 1b. Campaign state + legal dial window guard
        const campaign = await Campaign.findById(campaignId, {
          status: 1,
          timezone: 1,
          startTime: 1,
          endTime: 1,
          blackoutDates: 1,
          holidayCalendarId: 1,
          dialMode: 1,
          ratePerSecond: 1,
          agentPool: 1,
        }).lean();
        if (!campaign) {
          throw new UnrecoverableError(`Campaign ${campaignId} not found`);
        }

        if (campaign.status !== 'running') {
          jobLog.info({ status: campaign.status }, 'Campaign is not running — delaying job');
          await job.moveToDelayed(Date.now() + 30_000, job.token);
          throw new DelayedError();
        }

        const delayUntilWindow = getDelayUntilDialWindow(
          campaign.timezone ?? 'UTC',
          campaign.startTime,
          campaign.endTime,
        );
        if (delayUntilWindow && delayUntilWindow > 0) {
          jobLog.info({ delayMs: delayUntilWindow }, 'Outside dial window — delaying job');
          await job.moveToDelayed(Date.now() + delayUntilWindow, job.token);
          throw new DelayedError();
        }

        // 1c. Holiday / blackout date guard
        const todayInCampaignTz = getCurrentDateInTimezone(campaign.timezone ?? 'UTC');
        const allBlackoutDates = [...(campaign.blackoutDates ?? [])];

        // If campaign has a linked holiday calendar, fetch those dates too
        if (campaign.holidayCalendarId) {
          const holidayCal = await HolidayCalendar.findById(campaign.holidayCalendarId).lean();
          if (holidayCal?.dates) {
            const holidayDates = holidayCal.dates.map((d) => d.date);
            allBlackoutDates.push(...holidayDates);
          }
        }

        if (allBlackoutDates.includes(todayInCampaignTz)) {
          const tomorrowDelayMs = 24 * 60 * 60 * 1000;
          jobLog.info({ todayInCampaignTz }, 'Blackout date active — delaying job to next day');
          await job.moveToDelayed(Date.now() + tomorrowDelayMs, job.token);
          throw new DelayedError();
        }

        // 1d. Pacing guard for progressive/predictive modes
        if (campaign.dialMode === 'predictive' || campaign.dialMode === 'progressive') {
          const abandonRate = await getAbandonProxyRate(redis, campaignId);
          if (abandonRate > ABANDON_MAX_RATE) {
            const coolOffMs = 15_000;
            await redis.set(
              `pacing:governor:${campaignId}`,
              JSON.stringify({
                reason: 'abandon_rate',
                abandonRate,
                threshold: ABANDON_MAX_RATE,
                until: new Date(Date.now() + coolOffMs).toISOString(),
              }),
              'EX',
              120,
            );
            jobLog.warn({ abandonRate, threshold: ABANDON_MAX_RATE }, 'Abandon governor activated — delaying job');
            await job.moveToDelayed(Date.now() + coolOffMs, job.token);
            throw new DelayedError();
          }

          const filter = (campaign.agentPool ?? []).length > 0
            ? { _id: { $in: campaign.agentPool }, status: 'available' }
            : { status: 'available', campaignIds: campaignId };
          const availableAgents = await Agent.countDocuments(filter);
          const answerRate = await pacing.getAnswerRate(campaignId);
          const avgHandleTimeSec = await pacing.getAvgHandleTime(campaignId);
          const predictedRate = pacing.computeRecommendedRate(
            availableAgents,
            answerRate,
            avgHandleTimeSec,
          );
          const targetRate = Math.max(
            0.1,
            Math.min(predictedRate, Number(campaign.ratePerSecond ?? 1)),
          );

          const now = Date.now();
          const pacingKey = `pacing:next_dial_at:${campaignId}`;
          const currentNextDial = Number.parseInt((await redis.get(pacingKey)) ?? '0', 10);
          if (Number.isFinite(currentNextDial) && currentNextDial > now) {
            const delayMs = currentNextDial - now;
            await job.moveToDelayed(currentNextDial, job.token);
            jobLog.debug({ delayMs, targetRate }, 'Pacing delay applied');
            throw new DelayedError();
          }

          const intervalMs = Math.max(50, Math.round(1000 / targetRate));
          await redis.set(
            pacingKey,
            String(now + intervalMs),
            'PX',
            Math.max(intervalMs * 3, 1000),
          );
          await redis.set(
            `pacing:last_rate:${campaignId}`,
            JSON.stringify({
              targetRate,
              predictedRate,
              availableAgents,
              answerRate,
              avgHandleTimeSec,
              at: new Date().toISOString(),
            }),
            'EX',
            300,
          );
        }

        // 2. Store concurrency limit in Redis (ISSUE-02: single authoritative value for all replicas)
        await redis.set(`campaign:limit:${campaignId}`, String(concurrencyLimit), 'EX', 86400);

        // 3. Concurrency check
        const acquired = await concurrency.tryAcquire(campaignId);
        if (!acquired) {
          jobLog.debug('Concurrency limit reached — requeueing with delay');
          // ISSUE-08: must throw DelayedError after moveToDelayed
          await job.moveToDelayed(Date.now() + 2000, job.token);
          throw new DelayedError();
        }

        // 4. Create pre-flight call log
        const channelId = `dialer-${uuidv4()}`;
        let callLog;
        try {
          callLog = await CallLog.create({
            contactId,
            campaignId,
            channelId,
            asteriskCallerId: callerIdNumber,
            startTime: new Date(),
            disposition: 'no_answer',
            attempt,
            retryable: true,
            trace: [{
              at: new Date(),
              step: 'preflight',
              level: 'success',
              title: 'Pre-flight checks passed',
              detail: `Attempt ${attempt} is ready to dial ${phone} through ${sipTrunk}.`,
            }],
          });
        } catch (err: unknown) {
          // ISSUE-13: handle duplicate channelId (should never happen with UUID but be safe)
          if ((err as { code?: number }).code === 11000) {
            await concurrency.release(campaignId);
            throw new UnrecoverableError('Duplicate channelId — UUID collision (fatal)');
          }
          await concurrency.release(campaignId);
          throw err;
        }

        await Contact.updateOne({ _id: contactId }, { $set: { status: 'dialing' }, $push: { callLogs: callLog._id } });
        await Campaign.updateOne({ _id: campaignId }, { $inc: { 'stats.active': 1, 'stats.dialed': 1 } });
        await appendCallTrace(
          String(callLog._id),
          'asterisk_originate_request',
          'info',
          'Dial request sent to Asterisk',
          `Submitting originate request for endpoint ${sipTrunk}/${phone}.`,
        );

        // 5. Originate call
        try {
          await ari.originateCall({
            endpoint: `${sipTrunk}/${phone}`,
            app: process.env['ARI_APP_NAME'] ?? 'dialer',
            appArgs: [campaignId, contactId, String(callLog._id)].join(','),
            callerId: `"${callerIdName}" <${callerIdNumber}>`,
            timeout: 30,
            channelId,            // always a string (generated by uuidv4 above)
            variables: {          // always an object
              DIALER_CAMPAIGN_ID: campaignId,
              DIALER_CONTACT_ID: contactId,
              DIALER_CALLLOG_ID: String(callLog._id),
              DIALER_AMD_ACTION: amdAction,
              DIALER_IVR_FLOW_ID: ivrFlowId ?? '',
              DIALER_ATTEMPT: String(attempt),
            },
          });

          // Store channel context — includes channelId so stall watchdog can find it (ISSUE-01)
          await redis.setex(
            REDIS_KEYS.CHANNEL_CONTEXT(channelId),
            3600,
            JSON.stringify({ callLogId: String(callLog._id), contactId, campaignId, amdAction, ivrFlowId, channelId }),
          );

          await pacing.recordDialAttempt(campaignId, false);
          await appendCallTrace(
            String(callLog._id),
            'asterisk_originate_accepted',
            'success',
            'Asterisk accepted the dial request',
            `ARI accepted the originate request for ${sipTrunk}/${phone}. Waiting for channel events.`,
          );
          jobLog.info({ channelId }, 'Call originated successfully');
        } catch (err) {
          // Originate failed — release slot immediately
          await concurrency.release(campaignId);
          await decrementActiveClamp(campaignId);
          const reason = err instanceof Error ? err.message : String(err);
          await markCallFailure(
            String(callLog._id),
            'asterisk_originate',
            reason,
            `Asterisk rejected the originate request before the call entered Stasis. Endpoint: ${sipTrunk}/${phone}.`,
          );
          await Contact.updateOne({ _id: contactId }, { $set: { status: 'failed' } });
          jobLog.error({ err }, 'ARI originate failed');
          throw new Error(`Originate failed: ${reason}`);
        }
      } finally {
        if (inflightAcquired) {
          await releaseOwnedKey(redis, inflightKey, lockOwner);
        }
        if (leaseAcquired) {
          await releaseOwnedKey(redis, leaseKey, lockOwner);
        }
      }
    },
    workerOptions,
  );

  // ISSUE-01: stall handler releases the concurrency slot to prevent permanent freezes
  worker.on('stalled', (jobId) => {
    logger.warn({ jobId }, 'Job stalled — attempting slot recovery');
    void (async () => {
      try {
        const job = await Job.fromId<DialJobPayload>(worker, jobId);
        if (job?.data?.campaignId) {
          await concurrency.release(job.data.campaignId);
          await decrementActiveClamp(job.data.campaignId);
          logger.warn({ jobId, campaignId: job.data.campaignId }, 'Stall: concurrency slot recovered');
        }
      } catch (e) {
        logger.error({ e, jobId }, 'Failed to recover stalled job concurrency slot');
      }
    })();
  });

  worker.on('completed', (job) => logger.info({ jobId: job.id }, 'Dialer job completed'));
  worker.on('failed', (job, err) => logger.error({ jobId: job?.id, err: err.message }, 'Dialer job failed'));
  worker.on('error', (err) => logger.error({ err }, 'Dialer worker error'));

  return worker;
}
