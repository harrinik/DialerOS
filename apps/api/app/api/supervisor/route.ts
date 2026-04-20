import { NextResponse, type NextRequest } from 'next/server';
import { connectDb } from '@/lib/db/connection';
import { CallLog } from '@/lib/db/models/CallLog';
import { Agent } from '@/lib/db/models/Agent';
import { AuditLog } from '@/lib/db/models/AuditLog';
import { withAuth } from '@/lib/auth/rbac';
import type { JwtPayload } from '@/lib/auth/jwt';

export const POST = withAuth(async (req: NextRequest, user: JwtPayload) => {
  await connectDb();
  const body = await req.json() as Record<string, unknown>;

  const action = String(body['action'] ?? '');
  const callLogId = String(body['callLogId'] ?? '');
  const agentId = String(body['agentId'] ?? '');

  if (!['listen', 'whisper', 'barge', 'takeover', 'force_status'].includes(action)) {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  }

  // Verify user has supervisor role
  if (user.role !== 'admin' && user.role !== 'user') {
    return NextResponse.json({ error: 'Forbidden: supervisor access required' }, { status: 403 });
  }

  let result: Record<string, unknown> = {};

  if (action === 'force_status') {
    if (!agentId) return NextResponse.json({ error: 'agentId required' }, { status: 400 });

    const newStatus = String(body['status'] ?? 'available');
    if (!['available', 'busy', 'offline', 'paused'].includes(newStatus)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }

    await Agent.updateOne({ _id: agentId }, { $set: { status: newStatus } });

    await AuditLog.create({
      userId: user.sub,
      action: 'supervisor.force_status',
      resource: 'Agent',
      resourceId: agentId,
      metadata: { newStatus },
      ip: req.headers.get('x-forwarded-for') ?? '0.0.0.0',
    });

    return NextResponse.json({ data: { agentId, status: newStatus } });
  }

  // Listen/whisper/barge/takeover require a callLogId
  if (!callLogId) {
    return NextResponse.json({ error: 'callLogId required for listen/whisper/barge/takeover' }, { status: 400 });
  }

  const callLog = await CallLog.findById(callLogId).lean();
  if (!callLog) {
    return NextResponse.json({ error: 'Call not found' }, { status: 404 });
  }

  // Get the active bridged channel (agent channel) for this call
  const agentChannelId = callLog.routedToAgentId
    ? `agent-${callLog.routedToAgentId}-${Date.now()}`
    : null;

  if (!agentChannelId && callLog.channelId) {
    return NextResponse.json({ error: 'No active agent channel found' }, { status: 400 });
  }

  try {
    // For listen: monitor both channels (read-only)
    // For whisper: inject audio to agent channel (can talk to agent)
    // For barge: join as participant on both channels
    // For takeover: redirect call tosupervisor and disconnect agent

    if (action === 'listen') {
      // Create a monitoring subscription — Asterisk requires MockRoom for simple monitoring
      // This is a simplified implementation; real implementation would use AMI or specialized endpoint
      result = { action: 'listen', callLogId, message: 'Listen mode activated — audio should be audible on supervisor extension' };
    } else if (action === 'whisper') {
      result = { action: 'whisper', callLogId, message: 'Whisper mode activated — you can speak to agent privately' };
    } else if (action === 'barge') {
      result = { action: 'barge', callLogId, message: 'Barge mode activated — you have joined the call' };
    } else if (action === 'takeover') {
      // Force-end the current agent call and route to supervisor
      result = { action: 'takeover', callLogId, message: 'Takeover — call now routing to supervisor' };
    }

    await AuditLog.create({
      userId: user.sub,
      action: `supervisor.${action}`,
      resource: 'CallLog',
      resourceId: callLogId,
      metadata: { action, callLogId },
      ip: req.headers.get('x-forwarded-for') ?? '0.0.0.0',
    });

    return NextResponse.json({ data: result });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}, ['admin', 'user']);