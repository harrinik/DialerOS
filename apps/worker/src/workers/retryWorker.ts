/**
 * Retry Worker
 *
 * Fixes applied:
 *   ISSUE-05: Uses canonical @dialer/db models
 *   ISSUE-11: Exhaustive logging when retry rule not found
 *   ISSUE-22: Rate limiter added to prevent thundering herd
 */
import { Worker, type Job, Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import {
  QUEUE_NAMES, JOB_NAMES,
  type RetryJobPayload, type DialJobPayload,
  RETRYABLE_DISPOSITIONS,
} from '@dialer/shared';
import { Contact, Campaign } from '@dialer/db';
import { logger } from '../lib/logger.js';

export function createRetryWorker(redis: Redis): Worker {
  const dialQueue = new Queue<DialJobPayload>(QUEUE_NAMES.DIALER_CALLS, { connection: redis });

  const worker = new Worker<RetryJobPayload>(
    QUEUE_NAMES.DIALER_RETRY,
    async (job: Job<RetryJobPayload>) => {
      const { contactId, campaignId, reason, attempt } = job.data;
      const jobLog = logger.child({ jobId: job.id, contactId, campaignId, reason, attempt });
      jobLog.info('Retry worker processing');

      const [campaign, contact] = await Promise.all([
        Campaign.findById(campaignId).lean(),
        Contact.findById(contactId).lean(),
      ]);

      if (!campaign || campaign.status !== 'running') {
        jobLog.info('Campaign no longer running — skipping retry');
        return;
      }
      if (!contact) {
        jobLog.warn('Contact not found — skipping retry');
        return;
      }

      // ISSUE-11: Map disposition → retry rule with exhaustive logging
      const retryRuleMap: Record<string, { maxAttempts: number; delayMinutes: number } | undefined> = {
        busy:      campaign.retryRules?.busy,
        no_answer: campaign.retryRules?.noAnswer,  // camelCase in schema
        failed:    campaign.retryRules?.failed,
      };

      const rule = retryRuleMap[reason];
      if (!rule) {
        jobLog.error(
          { reason, availableKeys: Object.keys(retryRuleMap), retryRules: campaign.retryRules },
          'No retry rule found for disposition — check Campaign.retryRules schema',
        );
        await Contact.updateOne({ _id: contactId }, { $set: { status: 'completed' } });
        return;
      }

      if (attempt >= rule.maxAttempts) {
        jobLog.info({ rule, attempt }, 'Max retry attempts reached');
        await Contact.updateOne({ _id: contactId }, { $set: { status: 'completed' } });
        return;
      }

      const delayMs = rule.delayMinutes * 60 * 1000;
      const nextAttempt = attempt + 1;

      await Contact.updateOne(
        { _id: contactId },
        {
          $set: { status: 'retry_scheduled', nextRetryAt: new Date(Date.now() + delayMs) },
          $inc: { retryCount: 1 },
        },
      );

      const payload: DialJobPayload = {
        contactId:       String(contact._id),
        campaignId,
        phone:           contact.phone as string,
        callerIdName:    campaign.callerIdName as string,
        callerIdNumber:  campaign.callerIdNumber as string,
        sipTrunk:        campaign.sipTrunk as string,
        concurrencyLimit: campaign.concurrency as number,
        amdAction:       (campaign.amdAction as 'hangup' | 'continue') ?? 'hangup',
        attempt:         nextAttempt,
        // exactOptionalPropertyTypes: only include ivrFlowId if it has a value
        ...(campaign.ivrFlowId ? { ivrFlowId: String(campaign.ivrFlowId) } : {}),
      };

      await dialQueue.add(JOB_NAMES.ORIGINATE_CALL, payload, {
        delay:   delayMs,
        attempts: 1,
        jobId:   `retry-${contactId}-${nextAttempt}`,
      });

      jobLog.info({ delayMs, nextAttempt }, 'Retry scheduled');
    },
    {
      connection: redis,
      concurrency: 5,                          // ISSUE-22: reduced from 20
      limiter: { max: 50, duration: 1000 },    // ISSUE-22: max 50 retries/second
    },
  );

  worker.on('failed', (job, err) => logger.error({ jobId: job?.id, err: err.message }, 'Retry worker failed'));
  worker.on('error',  (err) => logger.error({ err }, 'Retry worker error'));
  return worker;
}
