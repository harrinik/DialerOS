# Predictive Dialer Platform

A production-grade, horizontally scalable outbound predictive dialer built with the MERN stack, Next.js, Redis (BullMQ), and Asterisk ARI.

## Architecture Highlights
- **Strict Separation of Concerns**: The platform handles *control* logic only. Telephony media is entirely managed by Asterisk.
- **Predictive Pacing Engine**: Custom Erlang-C implementation using rolling answer-rate tracking to dynamically adjust worker concurrency.
- **Event-Driven Resilience**: `apps/listener` acts as a stateless decision engine reacting to ARI WebSocket events. Asterisk is the single source of truth for channel state.
- **Predictable Queues**: `apps/worker` leverages BullMQ's atomic Redis Lua scripts to strictly enforce campaign concurrency limits.

## Project Structure
This is a `pnpm` workspace containing:
- `apps/api`: Next.js 14 (App Router) — REST APIs and React flow-based Dashboard UI.
- `apps/worker`: Node.js task runner — the Dialer Engine (origination, DNC check, pacing).
- `apps/listener`: Node.js WebSocket service — ARI events, call routing, and real-time Socket.IO gateway.
- `packages/shared`: Centralized domain models, Zod validation schemas, and system constants.

## Prerequisites
- Node.js 20+
- pnpm 8.x+
- Docker and Docker Compose
- Asterisk 18+ with ARI enabled

## Getting Started

1. **Install dependencies:**
   ```bash
   pnpm install
   ```

2. **Configure environment:**
   Copy `.env.example` to `.env` and adjust variables, ensuring your ARI credentials and MongoDB connection strings are valid.
   ```bash
   cp .env.example .env
   ```

3. **Start local infrastructure (MongoDB + Redis):**
   ```bash
   docker-compose up -d mongo redis
   ```

4. **Run development servers:**
   ```bash
    pnpm dev
   ```
   This command starts the API (Next.js Dashboard on port 3000), Worker, and Listener in watch mode.
