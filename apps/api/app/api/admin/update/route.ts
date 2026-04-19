/**
 * POST /api/admin/update  — Trigger a zero-downtime update
 * GET  /api/admin/update  — Read last 80 lines of update log (admin only)
 *
 * Auth:
 *   • GitHub webhook: X-Hub-Signature-256 HMAC header
 *   • Admin user: Bearer JWT
 *
 * Env:
 *   UPDATE_WEBHOOK_SECRET  — shared secret for GitHub webhook HMAC
 *   PROJECT_DIR            — path to the dialer project root (default: /opt/dialer)
 */

import { NextResponse, type NextRequest } from 'next/server';
import { withUser } from '@/lib/auth/withUser';
import type { JwtPayload } from '@/lib/auth/jwt';

// Force Node.js runtime — this route uses child_process + fs
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ── Update trigger (shared logic) ────────────────────────────────────────────
async function triggerUpdate(branch: string): Promise<void> {
  // Lazy-import Node.js built-ins so they're never bundled for the Edge
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execAsync = promisify(execFile);

  const projectDir = process.env['PROJECT_DIR'] ?? '/opt/dialer';
  const safeBranch = branch.replace(/[^a-zA-Z0-9/_.-]/g, '');

  try {
    const { stdout, stderr } = await execAsync(
      'bash',
      [`${projectDir}/update.sh`, '--branch', safeBranch],
      {
        timeout: 900_000, // 15 min max
        env: { ...process.env, UPDATE_BRANCH: safeBranch },
      },
    );
    if (stdout) console.info('[update]', stdout.slice(-500));
    if (stderr) console.warn('[update:stderr]', stderr.slice(-200));
  } catch (err) {
    console.error('[update] Script failed:', (err as Error).message);
  }
}

// ── POST — GitHub webhook or admin user trigger ───────────────────────────────
export async function POST(req: NextRequest): Promise<NextResponse> {
  const webhookSecret = process.env['UPDATE_WEBHOOK_SECRET'];
  const hubSig = req.headers.get('x-hub-signature-256');

  // ── Path A: GitHub webhook ──────────────────────────────────────────
  if (hubSig && webhookSecret) {
    const { createHmac, timingSafeEqual } = await import('node:crypto');
    const rawBody  = await req.text();
    const expected = `sha256=${createHmac('sha256', webhookSecret).update(rawBody).digest('hex')}`;

    const sigBuf = Buffer.from(hubSig);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
      return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 401 });
    }

    const payload = JSON.parse(rawBody) as { ref?: string };
    if (payload.ref !== 'refs/heads/main') {
      return NextResponse.json({ ok: true, message: 'Not main — skipped' });
    }

    void triggerUpdate('main');
    return NextResponse.json({ ok: true, message: 'Update triggered from webhook' });
  }

  // ── Path B: authenticated admin user ───────────────────────────────
  return withUser(async (authReq: NextRequest, user: JwtPayload) => {
    if (user.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
    const body = await authReq.json().catch(() => ({}) as Record<string, unknown>) as { branch?: string };
    const branch = String(body.branch ?? 'main');
    void triggerUpdate(branch);
    return NextResponse.json({ ok: true, message: `Update triggered for branch: ${branch}` });
  })(req);
}

// ── GET — update log tail (admin only) ───────────────────────────────────────
export const GET = withUser(async (_req: NextRequest, user: JwtPayload) => {
  if (user.role !== 'admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }
  const { readFile } = await import('node:fs/promises');
  const projectDir = process.env['PROJECT_DIR'] ?? '/opt/dialer';
  try {
    const log  = await readFile(`${projectDir}/.update.log`, 'utf8');
    const tail = log.split('\n').slice(-80).join('\n');
    return NextResponse.json({ ok: true, log: tail });
  } catch {
    return NextResponse.json({ ok: true, log: 'No update log found yet.' });
  }
});
