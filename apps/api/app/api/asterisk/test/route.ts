import { NextResponse } from 'next/server';
import { connectDb } from '@/lib/db/connection';
import { AsteriskSettings } from '@/lib/db/models/AsteriskSettings';
import { ariInfo, invalidateAriCache } from '@/lib/asterisk/ari-client';
import { getAmiClient } from '@/lib/asterisk/ami-client';
import { withUser } from '@/lib/auth/rbac';

// Wrap a promise with a timeout — rejects if it takes too long
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ]);
}

export const POST = withUser(async () => {
  await connectDb();
  const s = await AsteriskSettings.findOne({});
  if (!s) return NextResponse.json({ ok: false, error: 'No settings saved yet. Configure ARI/AMI credentials first.' }, { status: 400 });

  invalidateAriCache();
  const results: Record<string, unknown> = {};
  let allOk = true;

  // ── Test ARI (10s timeout) ───────────────────────────────────────────────
  try {
    const info = await withTimeout(ariInfo(), 10_000, 'ARI connection');
    results.ari = { ok: true, version: info.build?.version ?? 'unknown' };
  } catch (err) {
    results.ari = { ok: false, error: String(err) };
    allOk = false;
  }

  // ── Test AMI (10s timeout) ───────────────────────────────────────────────
  try {
    const ami  = await withTimeout(getAmiClient(), 10_000, 'AMI connection');
    const resp = await withTimeout(ami.sendAction({ Action: 'Ping' }), 5_000, 'AMI Ping');
    results.ami = { ok: resp.Response === 'Success', ping: resp.Ping };
    if (resp.Response !== 'Success') allOk = false;
  } catch (err) {
    results.ami = { ok: false, error: String(err) };
    allOk = false;
  }

  // ── Persist test result ──────────────────────────────────────────────────
  s.lastTestedAt = new Date();
  s.lastTestOk   = allOk;
  // Clear stale error when all pass; keep last error when something fails
  s.lastTestError = allOk
    ? undefined
    : [
        !(results.ari as { ok: boolean }).ok ? `ARI: ${(results.ari as { error: string }).error}` : null,
        !(results.ami as { ok: boolean }).ok ? `AMI: ${(results.ami as { error: string }).error}` : null,
      ].filter(Boolean).join(' | ');
  await s.save();

  return NextResponse.json({ ok: allOk, results });
});
