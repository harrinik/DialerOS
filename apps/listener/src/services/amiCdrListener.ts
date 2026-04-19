/**
 * AmiCdrListener
 *
 * Connects to Asterisk AMI via TCP and subscribes to CDR events.
 * AMI fires a `Cdr` event for EVERY completed call (Stasis AND non-Stasis),
 * which is the only way to track internal extension-to-extension calls.
 *
 * For each CDR event:
 *  1. Determines call type (internal / inbound / outbound / campaign)
 *  2. Saves a CdrLog record to MongoDB
 *  3. Emits a 'call:ended' socket event via the RealtimeGateway
 *
 * It also subscribes to Newchannel + Hangup events to emit live
 * 'channel:created' / 'channel:destroyed' socket events so the
 * dashboard channels widget updates in real-time (no 3s poll lag).
 */

import { EventEmitter } from 'node:events';
import { createConnection, type Socket } from 'node:net';
import { CdrLog } from '@dialer/db';
import type { RealtimeGateway } from '../gateway/realtimeGateway.js';
import { logger } from '../lib/logger.js';

// ── AMI packet parser ─────────────────────────────────────────────────────────

function parsePacket(packet: string): Record<string, string> {
  const obj: Record<string, string> = {};
  for (const line of packet.split('\r\n')) {
    const idx = line.indexOf(':');
    if (idx > 0) {
      const k = line.slice(0, idx).trim();
      const v = line.slice(idx + 1).trim();
      obj[k] = v;
    }
  }
  return obj;
}

function toDate(s: string | undefined): Date | undefined {
  if (!s || s === '0000-00-00 00:00:00') return undefined;
  return new Date(s.replace(' ', 'T') + 'Z');
}

// ── Main class ────────────────────────────────────────────────────────────────

export class AmiCdrListener extends EventEmitter {
  private sock: Socket | null = null;
  private buffer = '';
  private loggedIn = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly cfg: { host: string; port: number; user: string; pass: string },
    private readonly gateway: RealtimeGateway,
  ) {
    super();
  }

  connect(): void {
    if (this.sock) {
      this.sock.destroy();
      this.sock = null;
    }
    logger.info({ host: this.cfg.host, port: this.cfg.port }, 'AMI CDR listener connecting…');

    const sock = createConnection({ host: this.cfg.host, port: this.cfg.port });
    this.sock = sock;

    sock.setTimeout(15_000);
    sock.setEncoding('utf-8');

    sock.on('error', (err) => {
      logger.warn({ err: err.message }, 'AMI CDR socket error');
    });

    sock.on('timeout', () => {
      if (!this.loggedIn) {
        logger.warn('AMI CDR connection timed out before login');
        sock.destroy();
      } else {
        // Keepalive
        sock.write('Action: Ping\r\n\r\n');
        sock.setTimeout(30_000);
      }
    });

    sock.on('close', () => {
      logger.warn('AMI CDR socket closed — will reconnect in 10s');
      this.loggedIn = false;
      this.sock = null;
      this.scheduleReconnect();
    });

    sock.on('data', (chunk: string) => {
      this.buffer += chunk;

      // Banner detection (single \r\n line, not a \r\n\r\n packet)
      if (!this.loggedIn && this.buffer.includes('Asterisk Call Manager')) {
        this.buffer = this.buffer.replace(/Asterisk Call Manager\/[^\r\n]*\r?\n?/, '');
        sock.write(
          `Action: Login\r\nUsername: ${this.cfg.user}\r\nSecret: ${this.cfg.pass}\r\nEvents: on\r\n\r\n`,
        );
        sock.setTimeout(30_000);
      }

      // Packet processing
      const packets = this.buffer.split('\r\n\r\n');
      this.buffer = packets.pop() ?? '';

      for (const packet of packets) {
        if (!packet.trim()) continue;
        const obj = parsePacket(packet);

        if (!this.loggedIn) {
          if (obj['Response'] === 'Success') {
            this.loggedIn = true;
            logger.info('AMI CDR listener authenticated');
          } else if (obj['Response'] === 'Error') {
            logger.error({ msg: obj['Message'] }, 'AMI CDR authentication failed');
            sock.destroy();
          }
          continue;
        }

        const ev = obj['Event'];
        if (!ev) continue;

        if (ev === 'Cdr') {
          void this.handleCdr(obj);
        } else if (ev === 'Newchannel') {
          this.gateway.emitRawEvent('channel:created', {
            channel: obj['Channel'],
            callerIdNum: obj['CallerIDNum'],
            callerIdName: obj['CallerIDName'],
            state: obj['ChannelState'],
            context: obj['Context'],
            exten: obj['Exten'],
            uniqueId: obj['Uniqueid'],
            ts: new Date().toISOString(),
          });
        } else if (ev === 'Hangup') {
          this.gateway.emitRawEvent('channel:destroyed', {
            channel: obj['Channel'],
            uniqueId: obj['Uniqueid'],
            cause: obj['Cause-txt'],
            ts: new Date().toISOString(),
          });
        }
      }
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.connect(), 10_000);
  }

  private async handleCdr(obj: Record<string, string>): Promise<void> {
    try {
      const uniqueId = obj['UniqueID'] ?? obj['Uniqueid'] ?? '';
      if (!uniqueId) return;

      const src     = obj['Source']      ?? '';
      const dst     = obj['Destination'] ?? '';
      const ctx     = obj['DestinationContext'] ?? obj['DestContext'] ?? '';
      const lastApp = obj['LastApplication'] ?? '';

      // Determine call type
      let type: 'internal' | 'outbound' | 'inbound' | 'campaign' = 'internal';
      if (lastApp === 'Stasis')         type = 'campaign';
      else if (ctx === 'from-trunk')    type = 'inbound';
      else if (ctx === 'dialer-outbound') type = 'outbound';
      else if (ctx === 'agents')        type = 'internal';

      const startRaw  = obj['StartTime']  ?? obj['start'];
      const answerRaw = obj['AnswerTime'] ?? obj['answer'];
      const endRaw    = obj['EndTime']    ?? obj['end'];

      const startTime  = toDate(startRaw) ?? new Date();
      const answerTime = toDate(answerRaw);
      const endTime    = toDate(endRaw)   ?? new Date();

      const rawDisp = (obj['Disposition'] ?? 'NO ANSWER').toUpperCase() as ICdrDisposition;
      const disposition: ICdrDisposition =
        ['ANSWERED', 'NO ANSWER', 'BUSY', 'FAILED', 'CONGESTION'].includes(rawDisp)
          ? rawDisp : 'NO ANSWER';

      // Upsert to avoid duplicates on reconnect
      await CdrLog.findOneAndUpdate(
        { uniqueId },
        {
          $setOnInsert: {
            uniqueId,
            linkedId:        obj['LinkedID']   ?? '',
            channel:         obj['Channel']    ?? '',
            destChannel:     obj['DestinationChannel'] ?? obj['DestChannel'] ?? '',
            src, dst, dstContext: ctx,
            callerIdName:    obj['CallerIDName'] ?? '',
            callerIdNum:     obj['CallerIDNum']  ?? '',
            lastApp,
            lastData:        obj['LastData']     ?? '',
            startTime, answerTime, endTime,
            duration:        parseInt(obj['Duration']        ?? '0') || 0,
            billableSeconds: parseInt(obj['BillableSeconds'] ?? obj['Billsec'] ?? '0') || 0,
            disposition,
            amaFlags:        obj['AMAFlags']     ?? '',
            accountCode:     obj['AccountCode']  ?? '',
            userField:       obj['UserField']    ?? '',
            type,
          },
        },
        { upsert: true, new: false },
      );

      logger.info({ uniqueId, src, dst, disposition, type, duration: parseInt(obj['Duration'] ?? '0') || 0 }, 'CDR recorded');

      // Emit to dashboard
      this.gateway.emitRawEvent('cdr:completed', {
        uniqueId, src, dst, disposition, type,
        duration: parseInt(obj['Duration'] ?? '0') || 0,
        billableSeconds: parseInt(obj['BillableSeconds'] ?? obj['Billsec'] ?? '0') || 0,
        ts: new Date().toISOString(),
      });
    } catch (err) {
      logger.error({ err }, 'Failed to save CDR record');
    }
  }

  destroy(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.sock?.destroy();
    this.sock = null;
  }
}

type ICdrDisposition = 'ANSWERED' | 'NO ANSWER' | 'BUSY' | 'FAILED' | 'CONGESTION';
