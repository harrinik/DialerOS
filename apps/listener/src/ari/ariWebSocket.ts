import WebSocket from 'ws';
import { EventEmitter } from 'node:events';
import type { AriEvent } from '@dialer/shared';
import { DEFAULTS } from '@dialer/shared';
import { logger } from '../lib/logger.js';
import { AriClient } from '../services/ariClient.js';

/**
 * AriWebSocket
 *
 * Maintains a persistent, auto-reconnecting WebSocket connection
 * to the Asterisk REST Interface (ARI) event stream.
 *
 * Emits typed events via EventEmitter for the eventRouter to consume.
 */
export class AriWebSocket extends EventEmitter {
  private ws: WebSocket | null = null;
  private reconnectDelay: number;
  private readonly maxDelay: number;
  private isDestroyed = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pingInterval: NodeJS.Timeout | null = null;

  constructor() {
    super();
    this.reconnectDelay = parseInt(
      process.env['ARI_RECONNECT_INITIAL_DELAY_MS'] ??
        String(DEFAULTS.ARI_RECONNECT_INITIAL_MS),
      10,
    );
    this.maxDelay = parseInt(
      process.env['ARI_RECONNECT_MAX_DELAY_MS'] ??
        String(DEFAULTS.ARI_RECONNECT_MAX_MS),
      10,
    );
  }

  /** Build the ARI WebSocket URL — credentials via Basic auth header (ISSUE-23: not in URL) */
  private buildUrl(): string {
    const host = process.env['ARI_HOST'] ?? 'localhost';
    const port = process.env['ARI_PORT'] ?? '8088';
    const app  = process.env['ARI_APP_NAME'] ?? 'dialer';
    const tls  = process.env['ARI_TLS'] === 'true';
    const scheme = tls ? 'wss' : 'ws';
    // ISSUE-23: credentials removed from URL, passed as Basic auth header below
    return `${scheme}://${host}:${port}/ari/events?app=${app}&subscribeAll=true`;
  }

  private buildAuthHeader(): string {
    const user = process.env['ARI_USERNAME'] ?? 'dialer';
    const pass = process.env['ARI_PASSWORD'] ?? '';
    return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
  }

  /** Connect to ARI WebSocket */
  connect(): void {
    if (this.isDestroyed) return;

    const url = this.buildUrl();
    logger.info({ host: process.env['ARI_HOST'] }, 'Connecting to ARI WebSocket...');
    // ISSUE-23: pass credentials as Basic auth header, not in the URL
    this.ws = new WebSocket(url, { headers: { Authorization: this.buildAuthHeader() } });

    this.ws.on('open', () => {
      logger.info('ARI WebSocket connected');
      this.reconnectDelay = parseInt(
        process.env['ARI_RECONNECT_INITIAL_DELAY_MS'] ?? String(DEFAULTS.ARI_RECONNECT_INITIAL_MS),
        10,
      );

      this.pingInterval = setInterval(() => {
        if (this.ws?.readyState === WebSocket.OPEN) this.ws.ping();
      }, 30_000);

      this.emit('connected');
    });

    this.ws.on('message', (data) => {
      try {
        const event = JSON.parse(data.toString()) as AriEvent;
        logger.trace({ eventType: event.type }, 'ARI event received');
        this.emit('event', event);
      } catch (err) {
        logger.error({ err, raw: data.toString() }, 'Failed to parse ARI event');
      }
    });

    this.ws.on('close', (code, reason) => {
      logger.warn(
        { code, reason: reason.toString() },
        'ARI WebSocket closed',
      );
      this.clearPing();
      this.emit('disconnected');
      this.scheduleReconnect();
    });

    this.ws.on('error', (err) => {
      logger.error({ err }, 'ARI WebSocket error');
      // 'close' event fires after error, which triggers reconnect
    });

    this.ws.on('pong', () => {
      logger.trace('ARI WebSocket pong received');
    });
  }

  private clearPing(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.isDestroyed) return;

    // Exponential backoff with ±10% jitter
    const jitter = this.reconnectDelay * 0.1 * (Math.random() * 2 - 1);
    const delay = Math.min(this.reconnectDelay + jitter, this.maxDelay);

    logger.info(
      { delayMs: Math.round(delay) },
      'Scheduling ARI WebSocket reconnect',
    );

    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);

    // Exponential backoff: double the delay for next attempt
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxDelay);
  }

  /** Cleanly destroy the connection and stop reconnecting */
  destroy(): void {
    this.isDestroyed = true;
    this.clearPing();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.terminate();
      this.ws = null;
    }
    logger.info('ARI WebSocket destroyed');
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}
