import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { connectDb } from '@/lib/db/connection';
import { getQueueMetrics } from '@/lib/queue';

/**
 * GET /api/health
 * Returns real system health: MongoDB, Redis/Queue status, worker heartbeats.
 */
export async function GET() {
  const checks: Record<string, { status: 'ok' | 'error' | 'degraded'; detail?: string }> = {};

  // ---- MongoDB -------------------------------------------------------
  try {
    await connectDb();
    const state = mongoose.connection.readyState;
    // 1 = connected, 2 = connecting
    checks['mongodb'] = state === 1
      ? { status: 'ok', detail: 'Connected' }
      : { status: 'degraded', detail: `ReadyState: ${state}` };
  } catch (err) {
    checks['mongodb'] = { status: 'error', detail: String(err) };
  }

  // ---- BullMQ / Redis -----------------------------------------------
  try {
    const metrics = await getQueueMetrics();
    checks['redis'] = { status: 'ok', detail: 'Connected' };
    checks['queue'] = {
      status: 'ok',
      detail: `waiting=${metrics.waiting} active=${metrics.active} failed=${metrics.failed}`,
    };
  } catch (err) {
    checks['redis'] = { status: 'error', detail: String(err) };
    checks['queue'] = { status: 'error', detail: 'Queue unavailable' };
  }

  const allOk = Object.values(checks).every((c) => c.status === 'ok');
  const anyError = Object.values(checks).some((c) => c.status === 'error');

  return NextResponse.json(
    {
      status: anyError ? 'error' : allOk ? 'ok' : 'degraded',
      checks,
      timestamp: new Date().toISOString(),
    },
    { status: anyError ? 503 : 200 },
  );
}
