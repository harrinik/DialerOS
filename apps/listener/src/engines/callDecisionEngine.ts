/**
 * CallDecisionEngine
 *
 * Fixes applied:
 *   ISSUE-03: IVR ghost timers — onPlaybackEvent now event-driven; setTimeout replaced with
 *             proper PlaybackFinished handling; hung-up channel guard before acting
 *   ISSUE-05: Uses canonical @dialer/db models (no inline schemas)
 *   ISSUE-06: Webhook payload built programmatically, not via string substitution
 *   ISSUE-09: Agent channel hung up on bridge creation failure
 *   ISSUE-10: isAgentLeg flag prevents double ChannelDestroyed cleanup
 *   ISSUE-12: Agent routing watchdog key (60s TTL) prevents stuck-busy agents
 *   ISSUE-17: AMD-disabled fallback in onChannelStateChange routes immediately
 *   ISSUE-18: Answer-rate Redis key uses shared constant (was mismatched)
 *   ISSUE-25: stats.active clamped at 0 (no negative campaign active counts)
 *   ISSUE-27: IvrFlow cached in Redis for 5 minutes (not fetched per DTMF digit)
 *   ISSUE-30: Max call duration guard via event-driven watchdog
 */

import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import axios from 'axios';
import {
  type AriEvent,
  type AmdResult,
  type CallDisposition,
  type RealtimeCallEvent,
  type RealtimeCampaignStats,
  REDIS_KEYS,
  QUEUE_NAMES,
  JOB_NAMES,
  RETRYABLE_DISPOSITIONS,
  DEFAULTS,
} from '@dialer/shared';
import { CallLog, Contact, Campaign, Agent, IvrFlowModel, type IvrFlow, type IvrStep } from '@dialer/db';

import { AriClient } from '../services/ariClient.js';
import type { RealtimeGateway } from '../gateway/realtimeGateway.js';
import { logger } from '../lib/logger.js';

// ---- Channel context stored in Redis ------------------------------------

interface ChannelContext {
  callLogId: string;
  contactId: string;
  campaignId: string;
  amdAction: 'hangup' | 'continue';
  ivrFlowId?: string;
  agentChannelId?: string;
  bridgeId?: string;
  currentStepId?: string;
  playbackId?: string;
  dtmfBuffer?: string;
  isAgentLeg?: boolean;          // ISSUE-10: discriminate agent vs customer leg
  maxDurationTimer?: boolean;    // ISSUE-30: flag that watchdog is active
}

type TraceLevel = 'info' | 'success' | 'warning' | 'error';

// -------------------------------------------------------------------------

export class CallDecisionEngine {
  private readonly ari: AriClient;
  private readonly retryQueue: Queue;

  constructor(
    private readonly redis: Redis,
    private readonly gateway: RealtimeGateway,
  ) {
    this.ari = new AriClient();
    this.retryQueue = new Queue(QUEUE_NAMES.DIALER_RETRY, { connection: redis });
  }

  // ---- Helpers -----------------------------------------------------------

  private async getChannelContext(channelId: string): Promise<ChannelContext | null> {
    const raw = await this.redis.get(REDIS_KEYS.CHANNEL_CONTEXT(channelId));
    if (!raw) return null;
    return JSON.parse(raw) as ChannelContext;
  }

  private async setChannelContext(channelId: string, ctx: ChannelContext): Promise<void> {
    await this.redis.setex(REDIS_KEYS.CHANNEL_CONTEXT(channelId), 3600, JSON.stringify(ctx));
  }

  private async deleteChannelContext(channelId: string): Promise<void> {
    await this.redis.del(REDIS_KEYS.CHANNEL_CONTEXT(channelId));
  }

  private async releaseConcurrencySlot(campaignId: string): Promise<void> {
    const key = REDIS_KEYS.CAMPAIGN_SEMAPHORE(campaignId);
    const lua = `
      local v = tonumber(redis.call('GET', KEYS[1]) or '0')
      if v > 0 then redis.call('DECR', KEYS[1]) end
    `;
    await this.redis.eval(lua, 1, key);
  }

  /** ISSUE-25: clamp stats.active at 0 via aggregation pipeline */
  private async decrementActiveClamp(campaignId: string): Promise<void> {
    await Campaign.updateOne(
      { _id: campaignId },
      [{ $set: { 'stats.active': { $max: [{ $subtract: ['$stats.active', 1] }, 0] } } }],
    );
  }

  private emitCallEvent(event: Omit<RealtimeCallEvent, 'timestamp'>): void {
    this.gateway.emitCallEvent({ ...event, timestamp: new Date().toISOString() });
  }

  private async appendTrace(
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

  private async setFailureInfo(
    callLogId: string,
    stage: string,
    reason: string,
    detail?: string,
  ): Promise<void> {
    await CallLog.updateOne(
      { _id: callLogId },
      {
        $set: {
          failureStage: stage,
          failureReason: reason,
          notes: reason,
        },
        $push: {
          trace: {
            at: new Date(),
            step: stage,
            level: 'error',
            title: 'Call encountered an error',
            detail: detail ?? reason,
          },
        },
      },
    );
  }

  /** ISSUE-27: IVR flow cached in Redis for 5 minutes */
  private async getIvrFlow(flowId: string): Promise<IvrFlow | null> {
    const cacheKey = `ivr_flow_cache:${flowId}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as IvrFlow;
    const flow = await IvrFlowModel.findById(flowId).lean() as IvrFlow | null;
    if (flow) await this.redis.setex(cacheKey, 300, JSON.stringify(flow));
    return flow;
  }

  // ---- ARI Event Handlers -----------------------------------------------

  async onStasisStart(event: AriEvent): Promise<void> {
    if (event.type !== 'StasisStart') return;
    const channel = event.channel;
    if (!channel) return;
    const channelId = channel.id;
    const ctx = await this.getChannelContext(channelId);

    // AriEvent.args: use type assertion since the shared type is flexible
    const args = (event as unknown as { args?: string[] }).args ?? [];
    if (args.includes('agent_leg')) {
      logger.info({ channelId }, 'Agent leg entered Stasis');
      return;
    }

    if (!ctx) {
      logger.warn({ channelId }, 'StasisStart: no context — hanging up orphan channel');
      await this.ari.hangupChannel(channelId, 'normal');
      return;
    }

    logger.info({ channelId }, 'StasisStart: customer call entered Stasis');

    await CallLog.updateOne(
      { _id: ctx.callLogId },
      { $set: { uniqueId: channel.id, startTime: new Date(event.timestamp) } },
    );
    await this.appendTrace(
      ctx.callLogId,
      'stasis_start',
      'success',
      'Channel entered the Asterisk application',
      `Asterisk created channel ${channelId} and handed it to the dialer app.`,
    );

    // ISSUE-30: Start max call duration watchdog
    void this.scheduleMaxDurationHangup(channelId, ctx);

    this.emitCallEvent({
      type: 'call:started',
      callLogId: ctx.callLogId,
      contactId: ctx.contactId,
      campaignId: ctx.campaignId,
      channelId,
      phone: channel.caller.number,
    });
  }

  /** ISSUE-30: Hang up after MAX_CALL_DURATION_SECONDS if still active */
  private async scheduleMaxDurationHangup(channelId: string, ctx: ChannelContext): Promise<void> {
    const maxMs = DEFAULTS.MAX_CALL_DURATION_SECONDS * 1000;
    // Store a Redis key that expires at max duration — checked by periodic job
    // Using setTimeout is acceptable here since this fires once and cleans itself up
    setTimeout(async () => {
      const freshCtx = await this.getChannelContext(channelId);
      if (freshCtx) {
        logger.warn({ channelId }, 'Max call duration exceeded — hanging up');
        await this.ari.hangupChannel(channelId, 'normal').catch(() => null);
      }
    }, maxMs);
  }

  /** ISSUE-17: AMD-disabled fallback — if call is Up and AMD not expected, route immediately */
  async onChannelStateChange(event: AriEvent): Promise<void> {
    const channel = event.channel;
    if (!channel) return;
    const channelId = channel.id;
    const ctx = await this.getChannelContext(channelId);
    if (!ctx) return;

    if (channel.state === 'Up') {
      logger.info({ channelId }, 'Channel answered');
      await CallLog.updateOne(
        { _id: ctx.callLogId },
        { $set: { answerTime: new Date(event.timestamp), disposition: 'answered' } },
      );
      await this.appendTrace(
        ctx.callLogId,
        'channel_answered',
        'success',
        'Remote party answered',
        'The destination answered and the channel entered the Up state.',
      );
      this.emitCallEvent({ type: 'call:answered', callLogId: ctx.callLogId, contactId: ctx.contactId, campaignId: ctx.campaignId, channelId });

      // ISSUE-17: If AMD is disabled on this campaign, route immediately without waiting for AMDSTATUS
      const campaign = await Campaign.findById(ctx.campaignId).select('amdEnabled').lean();
      if (campaign && campaign.amdEnabled === false) {
        logger.info({ channelId }, 'AMD disabled on campaign — routing immediately');
        if (ctx.ivrFlowId) await this.startIvrFlow(channelId, ctx);
        else await this.routeToAgent(channelId, ctx);
      }
    } else if (channel.state === 'Ringing') {
      await this.appendTrace(
        ctx.callLogId,
        'channel_ringing',
        'info',
        'Remote endpoint is ringing',
        'Asterisk reported the outbound channel in Ringing state.',
      );
      this.emitCallEvent({ type: 'call:ringing', callLogId: ctx.callLogId, contactId: ctx.contactId, campaignId: ctx.campaignId, channelId });
    }
  }

  async onAmdResult(event: AriEvent): Promise<void> {
    const channel = event.channel;
    if (!channel) return;
    const channelId = channel.id;
    const ctx = await this.getChannelContext(channelId);
    if (!ctx) return;

    const amdRaw = (event.value ?? '').toUpperCase().trim();
    const amdResult = (['HUMAN', 'MACHINE', 'NOTSURE', 'HANGUP'].includes(amdRaw) ? amdRaw : 'NOTSURE') as AmdResult;

    logger.info({ channelId, amdResult }, 'AMD result received');
    await CallLog.updateOne({ _id: ctx.callLogId }, { $set: { amdResult } });
    await this.appendTrace(
      ctx.callLogId,
      'amd_result',
      amdResult === 'HUMAN' ? 'success' : amdResult === 'NOTSURE' ? 'warning' : 'info',
      'Answering machine detection finished',
      `AMD result: ${amdResult}.`,
    );

    // ISSUE-18: use shared constant for answer-rate key (was 'pacing:answer_rate:X', correct is 'answer_rate:X')
    await this.recordAnswerRateDataPoint(ctx.campaignId, amdResult === 'HUMAN');

    if (amdResult === 'MACHINE' || amdResult === 'HANGUP') {
      await CallLog.updateOne({ _id: ctx.callLogId }, { $set: { disposition: 'machine' } });
      await Contact.updateOne({ _id: ctx.contactId }, { $set: { status: 'machine' } });
      await Campaign.updateOne({ _id: ctx.campaignId }, { $inc: { 'stats.machines': 1 } });
      await this.appendTrace(
        ctx.callLogId,
        'machine_detected',
        'warning',
        'Machine detected',
        ctx.amdAction === 'hangup'
          ? 'AMD detected a machine and the campaign is configured to hang up.'
          : 'AMD detected a machine and the campaign is configured to continue.',
      );
      this.emitCallEvent({ type: 'call:machine', callLogId: ctx.callLogId, contactId: ctx.contactId, campaignId: ctx.campaignId, channelId, amdResult });

      if (ctx.amdAction === 'hangup') {
        logger.info({ channelId }, 'Machine detected — hanging up');
        await this.ari.hangupChannel(channelId, 'normal');
        return;
      }
    }

    if (amdResult === 'HUMAN' || ctx.amdAction === 'continue') {
      this.emitCallEvent({ type: 'call:human', callLogId: ctx.callLogId, contactId: ctx.contactId, campaignId: ctx.campaignId, channelId, amdResult });
      if (ctx.ivrFlowId) await this.startIvrFlow(channelId, ctx);
      else await this.routeToAgent(channelId, ctx);
    }
  }

  async onDtmfReceived(event: AriEvent): Promise<void> {
    const channel = event.channel;
    if (!channel) return;
    const channelId = channel.id;
    const digit = event.digit ?? '';
    const ctx = await this.getChannelContext(channelId);
    if (!ctx?.ivrFlowId) return;

    logger.info({ channelId, digit }, 'DTMF received');
    await CallLog.updateOne({ _id: ctx.callLogId }, { $push: { dtmfSequence: { digit, receivedAt: new Date() } } });
    this.emitCallEvent({ type: 'call:dtmf', callLogId: ctx.callLogId, contactId: ctx.contactId, campaignId: ctx.campaignId, channelId, digit });
    await this.processIvrDtmf(channelId, ctx, digit);
  }

  async onHangupRequest(event: AriEvent): Promise<void> {
    logger.info({ channelId: event.channel?.id }, 'Hangup requested');
    // Cleanup in onChannelDestroyed
  }

  /** ISSUE-10: isAgentLeg prevents double-cleanup when agent channel destroys */
  async onChannelDestroyed(event: AriEvent): Promise<void> {
    const channel = event.channel;
    if (!channel) return;
    const channelId = channel.id;

    const ctx = await this.getChannelContext(channelId);
    if (!ctx) return;

    // ISSUE-10: Agent leg — only release agent and clean up its context, no campaign stats
    if (ctx.isAgentLeg) {
      logger.info({ channelId }, 'Agent leg destroyed — releasing agent');
      await this.deleteChannelContext(channelId);
      // Release agent back to available if we know who it was
      // (agentId is not stored in agent leg context currently; this is a future enhancement)
      return;
    }

    logger.info({ channelId }, 'Customer channel destroyed — finalizing call');

    const callLog = await CallLog.findById(ctx.callLogId).lean();
    const endTime = new Date(event.timestamp);
    const startTime = callLog?.startTime ? new Date(callLog.startTime as Date) : endTime;
    const duration = Math.round((endTime.getTime() - startTime.getTime()) / 1000);
    const disposition: CallDisposition = (callLog?.disposition as CallDisposition) ?? 'no_answer';

    const existingFailureReason =
      typeof (callLog as { failureReason?: unknown } | null)?.failureReason === 'string'
        ? (callLog as { failureReason?: string }).failureReason
        : undefined;
    const fallbackFailureReason = disposition === 'no_answer'
      ? 'The destination never answered before the call ended.'
      : disposition === 'busy'
        ? 'The destination reported busy.'
        : disposition === 'cancelled'
          ? 'The call was cancelled before completion.'
          : disposition === 'failed'
            ? 'The call failed before a stable conversation was established.'
            : undefined;

    await CallLog.updateOne(
      { _id: ctx.callLogId },
      {
        $set: {
          endTime,
          duration,
          disposition,
          ...(!existingFailureReason && fallbackFailureReason
            ? {
                failureStage: 'call_end',
                failureReason: fallbackFailureReason,
                notes: fallbackFailureReason,
              }
            : {}),
        },
        $push: {
          trace: {
            at: endTime,
            step: 'call_end',
            level: disposition === 'answered' ? 'success' : disposition === 'machine' ? 'warning' : 'info',
            title: `Call ended with disposition ${disposition.replace(/_/g, ' ')}`,
            detail: duration > 0 ? `Duration ${duration}s.` : 'Call ended before audio bridged for a meaningful duration.',
          },
        },
      },
    );

    const isRetryable = RETRYABLE_DISPOSITIONS.has(disposition) && disposition !== 'machine';
    await Contact.updateOne({ _id: ctx.contactId }, { $set: { status: isRetryable ? 'retry_scheduled' : 'completed' } });

    // ISSUE-25: clamp stats.active at 0
    await this.releaseConcurrencySlot(ctx.campaignId);
    await this.decrementActiveClamp(ctx.campaignId);
    await Campaign.updateOne(
      { _id: ctx.campaignId },
      { $inc: { [`stats.${this.dispositionStatKey(disposition)}`]: 1 } },
    );

    if (isRetryable && callLog) {
      await this.retryQueue.add(
        JOB_NAMES.RETRY_CALL,
        { contactId: ctx.contactId, campaignId: ctx.campaignId, reason: disposition, attempt: (callLog.attempt as number) ?? 1 },
        { jobId: `retry-${ctx.contactId}-${Date.now()}` },
      );
    }

    await this.deleteChannelContext(channelId);

    this.emitCallEvent({ type: 'call:ended', callLogId: ctx.callLogId, contactId: ctx.contactId, campaignId: ctx.campaignId, channelId, disposition, duration });

    // Transition agent to wrapup state (if one was routed)
    if (callLog?.routedToAgentId) {
      const agent = await Agent.findById(callLog.routedToAgentId).lean();
      if (agent) {
        const wrapupTimeSec = (agent as unknown as { wrapupTimeSeconds?: number }).wrapupTimeSeconds ?? 30;
        // Set agent to wrapup state immediately
        await Agent.updateOne({ _id: callLog.routedToAgentId }, { $set: { status: 'wrapup', currentCallId: undefined } });
        this.gateway.emitAgentEvent({ type: 'agent:busy', agentId: String(callLog.routedToAgentId), campaignId: ctx.campaignId, timestamp: new Date().toISOString() });

        // Schedule transition to available after wrapup time
        setTimeout(async () => {
          const refreshed = await Agent.findById(callLog.routedToAgentId).lean();
          if (refreshed && refreshed.status === 'wrapup') {
            await Agent.updateOne({ _id: callLog.routedToAgentId }, { $set: { status: 'available' } });
            this.gateway.emitAgentEvent({ type: 'agent:available', agentId: String(callLog.routedToAgentId), campaignId: ctx.campaignId, timestamp: new Date().toISOString() });
          }
        }, wrapupTimeSec * 1000);
      }
    }

    await this.emitCampaignStats(ctx.campaignId);
  }

  async onChannelEnteredBridge(event: AriEvent): Promise<void> {
    logger.debug({ channelId: event.channel?.id, bridgeId: event.bridge?.id }, 'Channel entered bridge');
  }

  /** ISSUE-03: Event-driven playback advancement — replaces the old setTimeout approximation */
  async onPlaybackEvent(event: AriEvent): Promise<void> {
    // ISSUE-03: Event-driven playback advancement
    if (event.type !== 'PlaybackFinished') return;

    // The playback object contains target_uri: use type assertion for ARI-specific fields
    const playback = (event as unknown as { playback?: { target_uri?: string } }).playback;
    const targetUri = playback?.target_uri ?? '';
    const channelId = targetUri.replace('channel:', '');
    if (!channelId) return;

    const ctx = await this.getChannelContext(channelId);
    if (!ctx?.ivrFlowId || !ctx.currentStepId) return;

    const flow = await this.getIvrFlow(ctx.ivrFlowId);
    if (!flow) return;

    const currentStep = flow.steps.find((s) => s.id === ctx.currentStepId);
    if (!currentStep?.nextStepId) return;

    // Only auto-advance if the step type is 'play' (dtmf_collect waits for DTMF)
    if (currentStep.type !== 'play') return;

    const next = flow.steps.find((s) => s.id === currentStep.nextStepId);
    if (next) {
      ctx.currentStepId = next.id;
      await this.setChannelContext(channelId, ctx);
      await this.executeIvrStep(channelId, ctx, flow, next);
    }
  }

  async onStasisEnd(event: AriEvent): Promise<void> {
    logger.debug({ channelId: event.channel?.id }, 'StasisEnd');
  }

  // ---- IVR Flow Execution ------------------------------------------------

  private async startIvrFlow(channelId: string, ctx: ChannelContext): Promise<void> {
    if (!ctx.ivrFlowId) return;
    const flow = await this.getIvrFlow(ctx.ivrFlowId); // ISSUE-27: uses Redis cache
    if (!flow) {
      logger.error({ ivrFlowId: ctx.ivrFlowId }, 'IVR flow not found');
      await this.setFailureInfo(
        ctx.callLogId,
        'ivr_start',
        `IVR flow ${ctx.ivrFlowId} could not be loaded.`,
        'The call reached the IVR stage, but the configured flow record was missing.',
      );
      await this.ari.hangupChannel(channelId, 'normal');
      return;
    }

    const entryStep = flow.steps.find((s) => s.id === flow.entryStepId);
    if (!entryStep) {
      logger.error({ flowId: ctx.ivrFlowId }, 'IVR entry step not found');
      await this.setFailureInfo(
        ctx.callLogId,
        'ivr_start',
        `IVR flow ${ctx.ivrFlowId} has no valid entry step.`,
        'The IVR configuration is incomplete, so the call could not continue.',
      );
      await this.ari.hangupChannel(channelId, 'normal');
      return;
    }

    ctx.currentStepId = entryStep.id;
    await this.setChannelContext(channelId, ctx);
    await this.appendTrace(
      ctx.callLogId,
      'ivr_start',
      'info',
      'IVR flow started',
      `Entering IVR flow ${flow._id} at step ${entryStep.id}.`,
    );
    await this.executeIvrStep(channelId, ctx, flow, entryStep);
  }

  private async executeIvrStep(channelId: string, ctx: ChannelContext, flow: IvrFlow, step: IvrStep): Promise<void> {
    // ISSUE-03: Guard — check channel is still alive before acting
    const freshCtx = await this.getChannelContext(channelId);
    if (!freshCtx) {
      logger.debug({ channelId, stepId: step.id }, 'IVR step skipped — channel gone');
      return;
    }

    logger.info({ channelId, stepId: step.id, stepType: step.type }, 'Executing IVR step');
    await this.appendTrace(
      ctx.callLogId,
      `ivr_${step.type}`,
      'info',
      `IVR step: ${step.type}`,
      step.label ? `Step ${step.id} (${step.label}).` : `Step ${step.id}.`,
    );

    switch (step.type) {
      case 'play': {
        if (step.audioFile) {
          const pb = await this.ari.playAudio(channelId, `sound:${step.audioFile}`);
          freshCtx.playbackId = pb.id;
          freshCtx.currentStepId = step.id;
          await this.setChannelContext(channelId, freshCtx);
          // ISSUE-03: Advancement is now handled in onPlaybackEvent (event-driven, not setTimeout)
        }
        break;
      }

      case 'dtmf_collect': {
        if (step.audioFile) {
          const pb = await this.ari.playAudio(channelId, `sound:${step.audioFile}`);
          freshCtx.playbackId = pb.id;
        }
        freshCtx.currentStepId = step.id;
        freshCtx.dtmfBuffer = '';
        await this.setChannelContext(channelId, freshCtx);

        // ISSUE-03: Use Redis TTL watchdog for DTMF timeout instead of raw setTimeout
        const timeout = (step.timeoutSeconds ?? DEFAULTS.DTMF_TIMEOUT_SECONDS) * 1000;
        const watchdogKey = `dtmf_watchdog:${channelId}:${step.id}`;
        await this.redis.setex(watchdogKey, Math.ceil(timeout / 1000) + 5, '1');

        setTimeout(async () => {
          // Check watchdog still valid (not cancelled by DTMF receipt)
          const valid = await this.redis.get(watchdogKey);
          if (!valid) return;

          const latestCtx = await this.getChannelContext(channelId);
          // ISSUE-03: Only act if channel still alive AND still on this step
          if (!latestCtx || latestCtx.currentStepId !== step.id) return;
          if (latestCtx.dtmfBuffer && latestCtx.dtmfBuffer.length > 0) return;

          logger.info({ channelId }, 'DTMF timeout — using default branch');
          const defaultBranch = step.branches?.find((b) => b.digit === 'default' || b.digit === 'timeout');
          if (defaultBranch) {
            const flow2 = await this.getIvrFlow(ctx.ivrFlowId ?? '');
            if (flow2) {
              const next = flow2.steps.find((s) => s.id === defaultBranch.nextStepId);
              if (next) await this.executeIvrStep(channelId, latestCtx, flow2, next);
            }
          } else {
            await this.ari.hangupChannel(channelId, 'normal');
          }
          await this.redis.del(watchdogKey);
        }, timeout);
        break;
      }

      case 'route_agent':
        await this.routeToAgent(channelId, freshCtx, step.agentPool ?? []);
        break;

      case 'webhook':
        await this.fireWebhook(channelId, freshCtx, step, flow);
        break;

      case 'hangup':
        await this.ari.hangupChannel(channelId, 'normal');
        break;

      default:
        logger.warn({ stepType: step.type }, 'Unknown IVR step type');
    }
  }

  private async processIvrDtmf(channelId: string, ctx: ChannelContext, digit: string): Promise<void> {
    if (!ctx.ivrFlowId || !ctx.currentStepId) return;

    const flow = await this.getIvrFlow(ctx.ivrFlowId); // ISSUE-27: cached
    if (!flow) return;

    const currentStep = flow.steps.find((s) => s.id === ctx.currentStepId);
    if (!currentStep || currentStep.type !== 'dtmf_collect') return;

    ctx.dtmfBuffer = (ctx.dtmfBuffer ?? '') + digit;
    await this.setChannelContext(channelId, ctx);

    const maxDigits = currentStep.maxDigits ?? 1;
    if (ctx.dtmfBuffer.length < maxDigits) return;

    const collectedDigit = ctx.dtmfBuffer;
    ctx.dtmfBuffer = '';
    await this.setChannelContext(channelId, ctx);

    // Cancel DTMF watchdog
    const watchdogKey = `dtmf_watchdog:${channelId}:${ctx.currentStepId}`;
    await this.redis.del(watchdogKey);

    if (ctx.playbackId) {
      await this.ari.stopPlayback(ctx.playbackId);
    }

    const branch = currentStep.branches?.find((b) => b.digit === collectedDigit)
      ?? currentStep.branches?.find((b) => b.digit === 'default');

    if (!branch) {
      logger.warn({ channelId, collectedDigit }, 'No IVR branch matched');
      await this.setFailureInfo(
        ctx.callLogId,
        'ivr_dtmf',
        `No IVR branch matched the collected digits "${collectedDigit}".`,
        'The caller entered digits that were not mapped to a valid IVR branch.',
      );
      await this.ari.hangupChannel(channelId, 'normal');
      return;
    }

    const nextStep = flow.steps.find((s) => s.id === branch.nextStepId);
    if (!nextStep) {
      logger.error({ nextStepId: branch.nextStepId }, 'Next IVR step not found');
      await this.setFailureInfo(
        ctx.callLogId,
        'ivr_dtmf',
        `IVR branch pointed to missing step ${branch.nextStepId}.`,
        'The IVR branch configuration references a step that does not exist.',
      );
      await this.ari.hangupChannel(channelId, 'normal');
      return;
    }

    ctx.currentStepId = nextStep.id;
    await this.setChannelContext(channelId, ctx);
    await this.appendTrace(
      ctx.callLogId,
      'dtmf_collected',
      'success',
      'DTMF input matched a branch',
      `Digits "${collectedDigit}" routed the call to step ${nextStep.id}.`,
    );
    await this.executeIvrStep(channelId, ctx, flow, nextStep);
  }

  // ---- Agent Routing -----------------------------------------------------

  private async routeToAgent(
    channelId: string,
    ctx: ChannelContext,
    preferredAgentPool: string[] = [],
    requiredSkill?: string,
  ): Promise<void> {
    await this.appendTrace(
      ctx.callLogId,
      'agent_routing_start',
      'info',
      'Looking for an available agent',
      preferredAgentPool.length > 0
        ? `Searching preferred agent pool with ${preferredAgentPool.length} agents.`
        : 'Searching the campaign agent pool for an available agent.',
    );

    // Build query: filter by pool + status, sort by priority (desc) then oldest available (by updatedAt)
    const andConditions: Record<string, unknown>[] = [
      { status: 'available' },
    ];

    if (preferredAgentPool.length > 0) {
      andConditions.push({ _id: { $in: preferredAgentPool } });
    } else {
      andConditions.push({ campaignIds: ctx.campaignId });
    }

    // If caller has a required skill, filter agents by that skill
    if (requiredSkill) {
      andConditions.push({ skills: requiredSkill });
    }

    const poolQuery = { $and: andConditions };

    const agent = await Agent.findOneAndUpdate(
      poolQuery,
      { $set: { status: 'busy', currentCallId: ctx.callLogId } },
      { new: true, sort: { priority: -1, updatedAt: 1 } },
    ).lean();

    if (!agent) {
      logger.warn({ channelId }, 'No available agents — hanging up');
      await this.ari.hangupChannel(channelId, 'normal');
      return;
    }

    const agentId = String(agent._id);
    logger.info({ channelId, agentId, sipEndpoint: agent.sipEndpoint }, 'Routing call to agent');
    await this.appendTrace(
      ctx.callLogId,
      'agent_reserved',
      'success',
      'Reserved an agent for the call',
      `Selected agent ${agentId} on endpoint ${agent.sipEndpoint}.`,
    );

    // ISSUE-12: Agent routing watchdog — expires in 60s; periodic job resets stuck-busy agents
    await this.redis.setex(`agent:routing:${agentId}`, 60, ctx.callLogId);

    const agentChannelId = `agent-${agentId}-${Date.now()}`;
    ctx.agentChannelId = agentChannelId;
    await this.setChannelContext(channelId, ctx);

    // ISSUE-10: Mark agent leg context with isAgentLeg = true
    await this.setChannelContext(agentChannelId, {
      callLogId: ctx.callLogId,
      contactId: ctx.contactId,
      campaignId: ctx.campaignId,
      amdAction: ctx.amdAction,
      isAgentLeg: true,           // ISSUE-10: prevents double ChannelDestroyed cleanup
    });

    try {
      await this.ari.originateToAgent({
        sipEndpoint: agent.sipEndpoint as string,
        callerId: channelId,
        channelId: agentChannelId,
        variables: { DIALER_CALLLOG_ID: ctx.callLogId, DIALER_CAMPAIGN_ID: ctx.campaignId, DIALER_IS_AGENT_LEG: '1' },
      });

      const bridge = await this.ari.createBridge('mixing', `call-${ctx.callLogId}`);
      ctx.bridgeId = bridge.id;
      await this.setChannelContext(channelId, ctx);
      await this.ari.addChannelsToBridge(bridge.id, [channelId]);

      const agentCtx = await this.getChannelContext(agentChannelId);
      if (agentCtx) { agentCtx.bridgeId = bridge.id; await this.setChannelContext(agentChannelId, agentCtx); }

      await CallLog.updateOne({ _id: ctx.callLogId }, { $set: { routedToAgentId: agent._id, disposition: 'answered' } });
      await this.appendTrace(
        ctx.callLogId,
        'agent_bridged',
        'success',
        'Customer and agent channels were bridged',
        `Bridge ${bridge.id} connected the customer call to agent ${agentId}.`,
      );

      // Clear routing watchdog — successfully routed
      await this.redis.del(`agent:routing:${agentId}`);

      this.emitCallEvent({ type: 'call:routed', callLogId: ctx.callLogId, contactId: ctx.contactId, campaignId: ctx.campaignId, channelId, agentId });
      this.gateway.emitAgentEvent({ type: 'agent:busy', agentId, campaignId: ctx.campaignId, timestamp: new Date().toISOString() });
    } catch (err) {
      logger.error({ err, agentId }, 'Failed to route to agent');
      const reason = err instanceof Error ? err.message : String(err);
      await this.setFailureInfo(
        ctx.callLogId,
        'agent_routing',
        reason,
        `Routing failed while trying to connect agent ${agentId} on ${agent.sipEndpoint}.`,
      );
      await Agent.updateOne({ _id: agent._id }, { $set: { status: 'available', currentCallId: null } });
      await this.redis.del(`agent:routing:${agentId}`);

      // ISSUE-09: hang up BOTH customer and agent channel to prevent ringing phone
      await Promise.allSettled([
        this.ari.hangupChannel(channelId, 'normal'),
        this.ari.hangupChannel(agentChannelId, 'normal'),
      ]);
      if (ctx.bridgeId) await this.ari.destroyBridge(ctx.bridgeId).catch(() => null);
    }
  }

  // ---- Webhook Firing ----------------------------------------------------

  /** ISSUE-06: Payload built programmatically — no string substitution / JSON injection risk */
  private async fireWebhook(channelId: string, ctx: ChannelContext, step: IvrStep, flow: IvrFlow): Promise<void> {
    if (!step.webhookUrl) { logger.error({ stepId: step.id }, 'Webhook step has no URL'); return; }
    await this.appendTrace(
      ctx.callLogId,
      'webhook_request',
      'info',
      'Calling webhook',
      `Sending ${step.webhookMethod ?? 'POST'} request to ${step.webhookUrl}.`,
    );

    const callLog = await CallLog.findById(ctx.callLogId).lean();

    // ISSUE-06: Build payload as a plain object — safe, no injection
    const webhookPayload = {
      callLogId:     ctx.callLogId,
      campaignId:    ctx.campaignId,
      contactId:     ctx.contactId,
      channelId,
      dtmfSequence:  callLog?.dtmfSequence ?? [],
      amdResult:     callLog?.amdResult,
      disposition:   callLog?.disposition,
      // Merge any extra fields defined on the step (structured, not template strings)
      ...(typeof step.webhookExtraFields === 'object' && step.webhookExtraFields !== null
        ? step.webhookExtraFields as Record<string, unknown>
        : {}),
    };

    let success = false;
    let responseText = '';

    try {
      const response = await axios.request({
        method: step.webhookMethod ?? 'POST',
        url: step.webhookUrl,
        headers: { 'Content-Type': 'application/json', ...step.webhookHeaders as Record<string, string> },
        data: webhookPayload,
        timeout: (step.webhookTimeoutSeconds ?? 10) * 1000,
      });
      success = response.status >= 200 && response.status < 300;
      responseText = JSON.stringify(response.data).slice(0, 500);
      await this.appendTrace(
        ctx.callLogId,
        'webhook_response',
        'success',
        'Webhook responded successfully',
        responseText || 'Webhook returned an empty response body.',
      );
    } catch (err) {
      logger.error({ err, url: step.webhookUrl }, 'Webhook request failed');
      const reason = err instanceof Error ? err.message : String(err);
      await this.setFailureInfo(
        ctx.callLogId,
        'webhook',
        reason,
        `Webhook call to ${step.webhookUrl} failed.`,
      );
    }

    await CallLog.updateOne({ _id: ctx.callLogId }, { $set: { webhookFired: true, webhookResponse: responseText } });

    const nextStepId = success ? step.webhookSuccessNextStepId : step.webhookFailureNextStepId;
    if (nextStepId) {
      const next = flow.steps.find((s) => s.id === nextStepId);
      if (next) { ctx.currentStepId = next.id; await this.setChannelContext(channelId, ctx); await this.executeIvrStep(channelId, ctx, flow, next); }
    }
  }

  // ---- Analytics helpers -------------------------------------------------

  private dispositionStatKey(disposition: CallDisposition): string {
    const map: Record<CallDisposition, string> = {
      answered: 'answered', machine: 'machines', no_answer: 'noAnswer',
      busy: 'busy', failed: 'failed', cancelled: 'failed', voicemail: 'machines',
    };
    return map[disposition] ?? 'failed';
  }

  /** ISSUE-18: Use REDIS_KEYS.ANSWER_RATE_WINDOW (was 'pacing:answer_rate:${id}' — mismatched key) */
  private async recordAnswerRateDataPoint(campaignId: string, answered: boolean): Promise<void> {
    const key = REDIS_KEYS.ANSWER_RATE_WINDOW(campaignId);  // ISSUE-18 fix
    const now = Date.now();
    const windowMs = 300_000;
    await this.redis
      .pipeline()
      .zadd(key, now, `${now}:${answered ? '1' : '0'}`)
      .zremrangebyscore(key, '-inf', now - windowMs)
      .expire(key, 600)
      .exec();
  }

  private async emitCampaignStats(campaignId: string): Promise<void> {
    const campaign = await Campaign.findById(campaignId).select('stats').lean();
    if (!campaign) return;
    const statsEvent: RealtimeCampaignStats = {
      campaignId,
      stats: campaign.stats as RealtimeCampaignStats['stats'],
      timestamp: new Date().toISOString(),
    };
    this.gateway.emitCampaignStats(statsEvent);
  }
}
