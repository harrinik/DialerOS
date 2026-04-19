import { NextResponse } from 'next/server';
import { connectDb } from '@/lib/db/connection';
import { AsteriskSettings } from '@/lib/db/models/AsteriskSettings';
import { ariInfo, invalidateAriCache } from '@/lib/asterisk/ari-client';
import { getAmiClient } from '@/lib/asterisk/ami-client';
import { withUser } from '@/lib/auth/rbac';

export const POST = withUser(async () => {
  await connectDb();
  const s = await AsteriskSettings.findOne({});
  if (!s) return NextResponse.json({ error: 'No settings saved yet' }, { status: 400 });

  invalidateAriCache();
  const results: Record<string, unknown> = {};

  // Test ARI
  try {
    const info = await ariInfo();
    results.ari = { ok: true, version: info.build?.version ?? 'unknown' };
    s.lastTestOk = true;
  } catch (err) {
    results.ari = { ok: false, error: String(err) };
    s.lastTestOk = false;
    s.lastTestError = String(err);
  }

  // Test AMI
  try {
    const ami = await getAmiClient();
    const resp = await ami.sendAction({ Action: 'Ping' });
    results.ami = { ok: resp.Response === 'Success', ping: resp.Ping };
  } catch (err) {
    results.ami = { ok: false, error: String(err) };
  }

  s.lastTestedAt = new Date();
  await s.save();

  const allOk = (results.ari as { ok: boolean }).ok && (results.ami as { ok: boolean }).ok;
  return NextResponse.json({ ok: allOk, results });
});
