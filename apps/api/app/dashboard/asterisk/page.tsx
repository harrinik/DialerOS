'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CheckCircle2, XCircle, Loader2, Radio, Server, HardDrive, PhoneCall, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Settings {
  ariHost: string; ariPort: number; ariUser: string; ariPassword: string;
  ariSsl: boolean; ariApp: string;
  amiHost?: string; amiPort?: number; amiUser?: string; amiPassword?: string;
  soundsDir: string; recordingsDir: string;
  lastTestedAt?: string; lastTestOk?: boolean; lastTestError?: string;
}
type AriResult = { ok: boolean; version?: string; error?: string };
type AmiResult = { ok: boolean; ping?: string; error?: string };
type TestResult = {
  ok: boolean;
  results?: { ari?: AriResult; ami?: AmiResult };
  error?: string;  // present when API itself errors (e.g. 401, settings not saved)
};

const DEFAULT: Settings = { ariHost: 'localhost', ariPort: 8088, ariUser: 'dialer', ariPassword: '', ariSsl: false, ariApp: 'dialer', amiPort: 5038, soundsDir: '/var/lib/asterisk/sounds/dialer', recordingsDir: '/var/spool/asterisk/monitor' };

export default function AsteriskHubPage() {
  const [settings, setSettings] = useState<Settings>(DEFAULT);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [saved, setSaved] = useState(false);

  const token = () => localStorage.getItem('access_token') ?? '';
  const headers = () => ({ Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' });

  useEffect(() => {
    fetch('/api/asterisk/settings', { headers: headers() }).then(r => r.json())
      .then((d: { data: Settings | null }) => { if (d.data) setSettings(prev => ({ ...prev, ...d.data })); });
  }, []);

  const save = async () => {
    setSaving(true); setSaved(false);
    await fetch('/api/asterisk/settings', { method: 'PUT', headers: headers(), body: JSON.stringify(settings) });
    setSaving(false); setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  const test = async () => {
    setTesting(true); setTestResult(null);
    const r = await fetch('/api/asterisk/test', { method: 'POST', headers: headers() });
    const d = await r.json() as TestResult;
    setTestResult(d); setTesting(false);
  };

  const set = (key: keyof Settings, val: unknown) => setSettings(p => ({ ...p, [key]: val }));

  const StatusBadge = ({ ok, label }: { ok?: boolean; label: string }) => (
    ok === undefined ? <Badge variant="secondary">{label}: Not tested</Badge>
      : ok ? <Badge variant="running"><CheckCircle2 className="h-3 w-3" /> {label}: Connected</Badge>
      : <Badge variant="destructive"><XCircle className="h-3 w-3" /> {label}: Failed</Badge>
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Asterisk Connection Hub</h1>
        <p className="text-sm text-muted-foreground mt-1">Configure ARI and AMI credentials to enable all Asterisk management features.</p>
      </div>

      {/* Status bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <StatusBadge {...(settings.lastTestOk !== undefined ? { ok: settings.lastTestOk } : {})} label="ARI" />
        <StatusBadge {...(settings.lastTestOk !== undefined ? { ok: settings.lastTestOk } : {})} label="AMI" />
        {settings.lastTestedAt && (
          <span className="text-xs text-muted-foreground">Last tested: {new Date(settings.lastTestedAt).toLocaleString()}</span>
        )}
        {settings.lastTestError && (
          <span className="text-xs text-destructive truncate max-w-xs">{settings.lastTestError}</span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* ARI */}
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Radio className="h-4 w-4 text-primary" /> ARI (REST Interface)</CardTitle></CardHeader>
          <Separator />
          <CardContent className="pt-4 space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2 space-y-1.5"><Label>Host</Label><Input value={settings.ariHost} onChange={e => set('ariHost', e.target.value)} placeholder="localhost" /></div>
              <div className="space-y-1.5"><Label>Port</Label><Input type="number" value={settings.ariPort} onChange={e => set('ariPort', parseInt(e.target.value))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Username</Label><Input value={settings.ariUser} onChange={e => set('ariUser', e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Password</Label><Input type="password" value={settings.ariPassword} onChange={e => set('ariPassword', e.target.value)} placeholder="••••••••" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>App Name</Label><Input value={settings.ariApp} onChange={e => set('ariApp', e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Protocol</Label>
                <Select value={settings.ariSsl ? 'https' : 'http'} onValueChange={v => set('ariSsl', v === 'https')}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="http">HTTP (8088)</SelectItem><SelectItem value="https">HTTPS (8089)</SelectItem></SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* AMI */}
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Server className="h-4 w-4 text-primary" /> AMI (Manager Interface)</CardTitle></CardHeader>
          <Separator />
          <CardContent className="pt-4 space-y-4">
            <p className="text-xs text-muted-foreground">Leave blank to use the same host as ARI with port 5038.</p>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2 space-y-1.5"><Label>Host (optional)</Label><Input value={settings.amiHost ?? ''} onChange={e => set('amiHost', e.target.value || undefined)} placeholder="Same as ARI host" /></div>
              <div className="space-y-1.5"><Label>Port</Label><Input type="number" value={settings.amiPort ?? 5038} onChange={e => set('amiPort', parseInt(e.target.value))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Username (optional)</Label><Input value={settings.amiUser ?? ''} onChange={e => set('amiUser', e.target.value || undefined)} placeholder="Same as ARI user" /></div>
              <div className="space-y-1.5"><Label>Password (optional)</Label><Input type="password" value={settings.amiPassword ?? ''} onChange={e => set('amiPassword', e.target.value || undefined)} placeholder="••••••••" /></div>
            </div>
          </CardContent>
        </Card>

        {/* Directories */}
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><HardDrive className="h-4 w-4 text-primary" /> Asterisk Directories</CardTitle></CardHeader>
          <Separator />
          <CardContent className="pt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Sounds Directory</Label>
              <Input value={settings.soundsDir} onChange={e => set('soundsDir', e.target.value)} placeholder="/var/lib/asterisk/sounds/dialer" />
              <p className="text-xs text-muted-foreground">Where IVR audio files are stored on the Asterisk box.</p>
            </div>
            <div className="space-y-1.5">
              <Label>Recordings Directory</Label>
              <Input value={settings.recordingsDir} onChange={e => set('recordingsDir', e.target.value)} placeholder="/var/spool/asterisk/monitor" />
              <p className="text-xs text-muted-foreground">Where MixMonitor saves call recordings.</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Test result */}
      {testResult && (
        <Card className={cn('border', testResult.ok ? 'border-success/40 bg-success/5' : 'border-destructive/40 bg-destructive/5')}>
          <CardContent className="pt-4 space-y-2">
            <p className="font-semibold text-sm">
              {testResult.ok ? '✅ All connections successful' : '⚠️ Some connections failed'}
            </p>
            {/* Top-level error (e.g. settings not configured yet) */}
            {testResult.error && (
              <p className="text-xs text-destructive">{testResult.error}</p>
            )}
            {/* ARI result */}
            {testResult.results?.ari?.ok === true && (
              <p className="text-xs text-success">ARI: Connected — Asterisk {testResult.results.ari.version}</p>
            )}
            {testResult.results?.ari?.ok === false && (
              <p className="text-xs text-destructive">ARI: {testResult.results.ari.error}</p>
            )}
            {/* AMI result */}
            {testResult.results?.ami?.ok === true && (
              <p className="text-xs text-success">AMI: Connected — Ping OK</p>
            )}
            {testResult.results?.ami?.ok === false && (
              <p className="text-xs text-destructive">AMI: {testResult.results.ami.error}</p>
            )}
          </CardContent>
        </Card>
      )}

      <div className="flex gap-3">
        <Button onClick={save} disabled={saving}>{saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</> : saved ? <><CheckCircle2 className="h-4 w-4" /> Saved</> : 'Save Settings'}</Button>
        <Button variant="secondary" onClick={test} disabled={testing}>{testing ? <><Loader2 className="h-4 w-4 animate-spin" /> Testing…</> : <><RefreshCw className="h-4 w-4" /> Test Connection</>}</Button>
      </div>

      {/* Quick links */}
      <Card>
        <CardContent className="pt-4">
          <p className="text-sm font-medium mb-3">Next steps after connecting:</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 text-xs">
            {[
              { href: '/dashboard/asterisk/trunks', label: '1. Add SIP Trunk', icon: '🔗' },
              { href: '/dashboard/asterisk/endpoints', label: '2. Create Extensions', icon: '📞' },
              { href: '/dashboard/asterisk/inbound', label: '3. Map Inbound DIDs', icon: '📥' },
              { href: '/dashboard/asterisk/audio', label: '4. Upload IVR Audio', icon: '🔊' },
            ].map(l => (
              <a key={l.href} href={l.href} className="flex flex-col items-center gap-1 p-3 rounded-lg bg-secondary hover:bg-secondary/80 transition-colors text-center cursor-pointer">
                <span className="text-2xl">{l.icon}</span>
                <span className="text-muted-foreground">{l.label}</span>
              </a>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
