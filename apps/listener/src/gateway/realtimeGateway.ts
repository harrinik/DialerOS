import { createServer } from 'node:http';
import { Server as SocketIOServer } from 'socket.io';
import type {
  RealtimeCallEvent,
  RealtimeCampaignStats,
  RealtimeAgentEvent,
} from '@dialer/shared';
import { SOCKET_EVENTS, SOCKET_ROOMS } from '@dialer/shared';
import { logger } from '../lib/logger.js';

/**
 * RealtimeGateway
 *
 * Socket.IO server that pushes live call and campaign events
 * to connected dashboard clients.
 *
 * Rooms:
 * - "global"               → all connected clients
 * - "campaign:<id>"        → clients subscribed to a specific campaign
 * - "agent:<id>"           → agent-specific events
 */
export class RealtimeGateway {
  private readonly io: SocketIOServer;

  constructor() {
    const httpServer = createServer();
    this.io = new SocketIOServer(httpServer, {
      cors: {
        origin: process.env['API_BASE_URL'] ?? 'http://localhost:3000',
        methods: ['GET', 'POST'],
        credentials: true,
      },
      transports: ['websocket', 'polling'],
    });

    const port = parseInt(process.env['GATEWAY_PORT'] ?? '3001', 10);
    httpServer.listen(port, () => {
      logger.info({ port }, 'Realtime gateway listening');
    });

    this.setupConnectionHandling();
  }

  private setupConnectionHandling(): void {
    this.io.on('connection', (socket) => {
      logger.debug({ socketId: socket.id }, 'Client connected to gateway');

      // Client subscribes to a campaign room
      socket.on('subscribe:campaign', (campaignId: string) => {
        if (typeof campaignId !== 'string' || !campaignId) return;
        void socket.join(SOCKET_ROOMS.CAMPAIGN(campaignId));
        logger.debug(
          { socketId: socket.id, campaignId },
          'Client subscribed to campaign room',
        );
      });

      // Client unsubscribes from a campaign room
      socket.on('unsubscribe:campaign', (campaignId: string) => {
        void socket.leave(SOCKET_ROOMS.CAMPAIGN(campaignId));
      });

      // Agent subscribes to their own room
      socket.on('subscribe:agent', (agentId: string) => {
        if (typeof agentId !== 'string' || !agentId) return;
        void socket.join(SOCKET_ROOMS.AGENT(agentId));
      });

      socket.on('disconnect', (reason) => {
        logger.debug(
          { socketId: socket.id, reason },
          'Client disconnected from gateway',
        );
      });

      // Immediately send a welcome ping with server time
      socket.emit('connected', { ts: new Date().toISOString() });

      // Join global room
      void socket.join(SOCKET_ROOMS.GLOBAL);
    });
  }

  /** Emit a call lifecycle event to all relevant rooms */
  emitCallEvent(event: RealtimeCallEvent): void {
    const campaignRoom = SOCKET_ROOMS.CAMPAIGN(event.campaignId);

    // Emit to campaign-specific room and global
    this.io.to(campaignRoom).emit(event.type, event);
    this.io.to(SOCKET_ROOMS.GLOBAL).emit(event.type, event);

    logger.trace(
      { type: event.type, campaignId: event.campaignId },
      'Realtime call event emitted',
    );
  }

  /** Emit updated campaign stats */
  emitCampaignStats(stats: RealtimeCampaignStats): void {
    const campaignRoom = SOCKET_ROOMS.CAMPAIGN(stats.campaignId);
    this.io
      .to(campaignRoom)
      .emit(SOCKET_EVENTS.CAMPAIGN_STATS, stats);
    this.io
      .to(SOCKET_ROOMS.GLOBAL)
      .emit(SOCKET_EVENTS.CAMPAIGN_STATS, stats);
  }

  /** Emit agent status change */
  emitAgentEvent(event: RealtimeAgentEvent): void {
    this.io
      .to(SOCKET_ROOMS.GLOBAL)
      .emit(SOCKET_EVENTS.AGENT_STATUS_CHANGED, event);

    if (event.campaignId) {
      this.io
        .to(SOCKET_ROOMS.CAMPAIGN(event.campaignId))
        .emit(SOCKET_EVENTS.AGENT_STATUS_CHANGED, event);
    }

    if (event.agentId) {
      this.io
        .to(SOCKET_ROOMS.AGENT(event.agentId))
        .emit(SOCKET_EVENTS.AGENT_STATUS_CHANGED, event);
    }
  }

  /** Returns connected client count (useful for health checks) */
  get clientCount(): number {
    return this.io.engine.clientsCount;
  }
}
