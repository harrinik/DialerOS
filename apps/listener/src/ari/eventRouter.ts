import type { AriEvent } from '@dialer/shared';
import type { CallDecisionEngine } from '../engines/callDecisionEngine.js';
import { logger } from '../lib/logger.js';

/**
 * AriEventRouter
 *
 * Routes raw ARI event objects to strongly-typed handlers in the
 * CallDecisionEngine. All business logic lives in the engine;
 * this module is purely a dispatch table.
 */
export class AriEventRouter {
  constructor(private readonly engine: CallDecisionEngine) {}

  /**
   * Route an incoming ARI event to the appropriate handler.
   * Unknown event types are logged at trace level and ignored.
   */
  async route(event: AriEvent): Promise<void> {
    try {
      switch (event.type) {
        case 'StasisStart':
          await this.engine.onStasisStart(event);
          break;

        case 'StasisEnd':
          await this.engine.onStasisEnd(event);
          break;

        case 'ChannelStateChange':
          await this.engine.onChannelStateChange(event);
          break;

        case 'ChannelVarset':
          // AMD result is delivered as a channel variable by Asterisk
          if (event.variable === 'AMDSTATUS' || event.variable === 'AMD_STATUS') {
            await this.engine.onAmdResult(event);
          }
          // Other variable sets can be handled here in future
          break;

        case 'ChannelDtmfReceived':
          await this.engine.onDtmfReceived(event);
          break;

        case 'ChannelHangupRequest':
          await this.engine.onHangupRequest(event);
          break;

        case 'ChannelDestroyed':
          await this.engine.onChannelDestroyed(event);
          break;

        case 'BridgeCreated':
        case 'BridgeDestroyed':
          // Informational — no action required in v1
          logger.debug({ type: event.type }, 'Bridge event (ignored)');
          break;

        case 'ChannelEnteredBridge':
          await this.engine.onChannelEnteredBridge(event);
          break;

        case 'PlaybackStarted':
        case 'PlaybackFinished':
          await this.engine.onPlaybackEvent(event);
          break;

        default:
          logger.trace({ type: event.type }, 'Unhandled ARI event type');
      }
    } catch (err) {
      logger.error(
        { err, eventType: event.type, channelId: event.channel?.id },
        'Error routing ARI event',
      );
      // Never rethrow — a single bad event must not crash the listener
    }
  }
}
