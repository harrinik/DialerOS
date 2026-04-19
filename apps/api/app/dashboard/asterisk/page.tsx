'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CheckCircle2, XCircle, Loader2, Radio, Server, HardDrive, PhoneCall, RefreshCw, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Settings {
  ariHost: string; ariPort: number; ariUser: string;
  ariSsl: boolean; ariApp: string;
  amiHost?: string; amiPort?: number; amiUser?: string;
  soundsDir: string; recordingsDir: string;
  lastTestedAt?: string; lastTestOk?: boolean; lastTestError?: string;
  // passwords never populate from server — kept separate
}

type AriResult = { ok: boolean; version?: string; error?: string };
type AmiResult = { ok: boolean; ping?: string; error?: string };
type TestResult = {
  ok: boolean;
  results?: { ari?: AriResult; ami?: AmiResult };
  error?: string;
};

// Defaults match /install_asterisk.sh exactly
const DEFAULT: Settings = {
  ariHost:      'host.docker.internal',  // Docker containers use this to reach the host
  ariPort:      8088,
  ariUser:      'dialer',
  ariSsl:       false,
  ariApp:       'dialer',
  amiPort:      5038,
  soundsDir:    '/var/lib/asterisk/sounds/dialer',     // SOUNDS_DIR in install_asterisk.sh
  recordingsDir:'/var/spool/asterisk/monitor',          // RECORDINGS_DIR in install_asterisk.sh
};

export default function AsteriskHubPage() {
  const [settings, setSettings] = useState<Settings>(DEFAULT);
  // Passwords are kept separate — never pre-filled from server (security)
  const [ariPassword, setAriPassword]   = useState('');
  const [amiPassword, setAmiPassword]   = useState('');
  const [hasExistingAri, setHasExistingAri] = useState(false);
  const [hasExistingAmi, setHasExistingAmi] = useState(false);

  const [loading,  setLoading]  = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving,   setSaving]   = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [testing,  setTesting]  = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [saved,    setSaved]    = useState(false);

  const getHeaders = useCallback(() => ({
    Authorization: `Bearer ${localStorage.getItem('access_token') ?? ''}`,
    'Content-Type': 'application/json',
  }), []);

  // Load settings from server on mount
  const loadSettings = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const r = await fetch('/api/asterisk/settings', { headers: getHeaders() });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: `HTTP ${r.status}` })) as { error?: string };
        setLoadError(err.error ?? `Failed to load settings (${r.status})`);
        return;
      }
      const d = await r.json() as { data: (Settings & { ariPasswordSet?: boolean; amiPasswordSet?: boolean }) | null };
      if (d.data) {
        const { ariPasswordSet, amiPasswordSet, ...rest } = d.data;
        setSettings(prev => ({ ...prev, ...rest }));
        setHasExistingAri(!!ariPasswordSet);
        setHasExistingAmi(!!amiPasswordSet);
      }
    } catch (e) {
      setLoadError(String(e));
    } finally {
      setLoading(false);
    }
  }, [getHeaders]);

  useEffect(() => { void loadSettings(); }, [loadSettings]);

  const save = async () => {
    setSaving(true); setSaved(false); setSaveError(null);
    try {
      const payload: Record<string, unknown> = { ...settings };
      // Only include passwords when non-empty — blank = keep existing
      if (ariPassword) payload.ariPassword = ariPassword;
      if (amiPassword) payload.amiPassword = amiPassword;

      const r = await fetch('/api/asterisk/settings', {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify(payload),
      });

      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: `HTTP ${r.status}` })) as { error?: string };
        setSaveError(err.error ?? `Save failed (${r.status})`);
        return;
      }

      const d = await r.json() as { data: Settings & { ariPasswordSet?: boolean; amiPasswordSet?: boolean } };
      if (d.data) {
        const { ariPasswordSet, amiPasswordSet, ...rest } = d.data;
        setSettings(prev => ({ ...prev, ...rest }));
        setHasExistingAri(!!ariPasswordSet);
        setHasExistingAmi(!!amiPasswordSet);
      }
      // Clear password inputs after successful save — they're now stored
      if (ariPassword) setAriPassword('');
      if (amiPassword) setAmiPassword('');
      setSaved(true);
      setTimeout(() => setSaved(false), 4000);
    } catch (e) {
      setSaveError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true); setTestResult(null);
    try {
      const r = await fetch('/api/asterisk/test', { method: 'POST', headers: getHeaders() });
      const d = await r.json() as TestResult;
      setTestResult(d);
    } catch (e) {
      setTestResult({ ok: false, error: String(e) });
    } finally {
      setTesting(false);
    }
  };

  const set = (key: keyof Settings, val: unknown) =>
    setSettings(p => ({ ...p, [key]: val }));

  const StatusBadge = ({ ok, label }: { ok?: boolean; label: string }) =>
    ok === undefined
      ? <Badge variant="secondary">{label}: Not tested</Badge>
      : ok
        ? <Badge variant="running"><CheckCircle2 className="h-3 w-3" /> {label}: Connected</Badge>
        : <Badge variant="destructive"><XCircle className="h-3 w-3" /> {label}: Failed</Badge>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Asterisk Connection Hub</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configure ARI and AMI credentials. Changes take effect immediately — no restart needed.
        </p>
      </div>

      {/* Load error */}
      {loadError && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>Could not load settings: {loadError}</span>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={loadSettings}>Retry</Button>
        </div>
      )}

      {/* Status bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <StatusBadge {...(settings.lastTestOk !== undefined ? { ok: settings.lastTestOk } : {})} label="ARI" />
        <StatusBadge {...(settings.lastTestOk !== undefined ? { ok: settings.lastTestOk } : {})} label="AMI" />
        {settings.lastTestedAt && (
          <span className="text-xs text-muted-foreground">
            Last tested: {new Date(settings.lastTestedAt).toLocaleString()}
          </span>
        )}
        {settings.lastTestError && (
          <span className="text-xs text-destructive truncate max-w-xs">{settings.lastTestError}</span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* ARI */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Radio className="h-4 w-4 text-primary" /> ARI (REST Interface)
            </CardTitle>
          </CardHeader>
          <Separator />
          <CardContent className="pt-4 space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2 space-y-1.5">
                <Label>Host</Label>
                <Input
                  value={settings.ariHost}
                  onChange={e => set('ariHost', e.target.value)}
                  placeholder="host.docker.internal"
                  disabled={loading}
                />
                <p className="text-xs text-muted-foreground">
                  Use <code className="bg-muted px-1 rounded">host.docker.internal</code> when Asterisk runs on the host and DialerOS runs in Docker.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label>Port</Label>
                <Input
                  type="number"
                  value={settings.ariPort}
                  onChange={e => set('ariPort', parseInt(e.target.value))}
                  disabled={loading}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Username</Label>
                <Input
                  value={settings.ariUser}
                  onChange={e => set('ariUser', e.target.value)}
                  disabled={loading}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Password</Label>
                <Input
                  type="password"
                  value={ariPassword}
                  onChange={e => setAriPassword(e.target.value)}
                  placeholder={hasExistingAri ? '(unchanged — set)' : 'Enter ARI password'}
                  disabled={loading}
                />
                <p className="text-xs text-muted-foreground">
                  Leave blank to keep existing password.
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>App Name</Label>
                <Input
                  value={settings.ariApp}
                  onChange={e => set('ariApp', e.target.value)}
                  disabled={loading}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Protocol</Label>
                <Select
                  value={settings.ariSsl ? 'https' : 'http'}
                  onValueChange={v => set('ariSsl', v === 'https')}
                  disabled={loading}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="http">HTTP (8088)</SelectItem>
                    <SelectItem value="https">HTTPS (8089)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* AMI */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Server className="h-4 w-4 text-primary" /> AMI (Manager Interface)
            </CardTitle>
          </CardHeader>
          <Separator />
          <CardContent className="pt-4 space-y-4">
            <p className="text-xs text-muted-foreground">Leave blank to use the same host as ARI with port 5038.</p>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2 space-y-1.5">
                <Label>Host (optional)</Label>
                <Input
                  value={settings.amiHost ?? ''}
                  onChange={e => set('amiHost', e.target.value || undefined)}
                  placeholder="Same as ARI host"
                  disabled={loading}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Port</Label>
                <Input
                  type="number"
                  value={settings.amiPort ?? 5038}
                  onChange={e => set('amiPort', parseInt(e.target.value))}
                  disabled={loading}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Username (optional)</Label>
                <Input
                  value={settings.amiUser ?? ''}
                  onChange={e => set('amiUser', e.target.value || undefined)}
                  placeholder="Same as ARI user"
                  disabled={loading}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Password (optional)</Label>
                <Input
                  type="password"
                  value={amiPassword}
                  onChange={e => setAmiPassword(e.target.value)}
                  placeholder={hasExistingAmi ? '(unchanged — set)' : 'Enter AMI password'}
                  disabled={loading}
                />
                <p className="text-xs text-muted-foreground">Leave blank to keep existing.</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Directories */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <HardDrive className="h-4 w-4 text-primary" /> Asterisk Directories
            </CardTitle>
          </CardHeader>
          <Separator />
          <CardContent className="pt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Sounds Directory</Label>
              <Input
                value={settings.soundsDir}
                onChange={e => set('soundsDir', e.target.value)}
                placeholder="/var/lib/asterisk/sounds/dialer"
                disabled={loading}
              />
              <p className="text-xs text-muted-foreground">
                Set by <code className="bg-muted px-1 rounded">install_asterisk.sh</code> as <code className="bg-muted px-1 rounded">/var/lib/asterisk/sounds/dialer</code>
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Recordings Directory</Label>
              <Input
                value={settings.recordingsDir}
                onChange={e => set('recordingsDir', e.target.value)}
                placeholder="/var/spool/asterisk/monitor"
                disabled={loading}
              />
              <p className="text-xs text-muted-foreground">
                Set by <code className="bg-muted px-1 rounded">install_asterisk.sh</code> as <code className="bg-muted px-1 rounded">/var/spool/asterisk/monitor</code>
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Test result */}
      {testResult && (
        <Card className={cn('border', testResult.ok
          ? 'border-success/40 bg-success/5'
          : 'border-destructive/40 bg-destructive/5'
        )}>
          <CardContent className="pt-4 space-y-2">
            <p className="font-semibold text-sm">
              {testResult.ok ? '✅ All connections successful' : '⚠️ Some connections failed'}
            </p>
            {testResult.error && (
              <p className="text-xs text-destructive">{testResult.error}</p>
            )}
            {testResult.results?.ari?.ok === true && (
              <p className="text-xs text-success">ARI ✓ — Asterisk {testResult.results.ari.version}</p>
            )}
            {testResult.results?.ari?.ok === false && (
              <p className="text-xs text-destructive">ARI ✗ — {testResult.results.ari.error}</p>
            )}
            {testResult.results?.ami?.ok === true && (
              <p className="text-xs text-success">AMI ✓ — Ping OK</p>
            )}
            {testResult.results?.ami?.ok === false && (
              <p className="text-xs text-destructive">AMI ✗ — {testResult.results.ami.error}</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Save error */}
      {saveError && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>Save failed: {saveError}</span>
        </div>
      )}

      <div className="flex gap-3">
        <Button onClick={save} disabled={saving || loading}>
          {saving
            ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</>
            : saved
              ? <><CheckCircle2 className="h-4 w-4" /> Saved</>
              : 'Save Settings'
          }
        </Button>
        <Button variant="secondary" onClick={test} disabled={testing || loading}>
          {testing
            ? <><Loader2 className="h-4 w-4 animate-spin" /> Testing…</>
            : <><RefreshCw className="h-4 w-4" /> Test Connection</>
          }
        </Button>
        <Button variant="ghost" onClick={loadSettings} disabled={loading} size="sm" className="ml-auto">
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
        </Button>
      </div>

      {/* Quick links */}
      <Card>
        <CardContent className="pt-4">
          <p className="text-sm font-medium mb-3">Next steps after connecting:</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 text-xs">
            {[
              { href: '/dashboard/asterisk/trunks',    label: '1. Add SIP Trunk',    icon: '🔗' },
              { href: '/dashboard/asterisk/endpoints', label: '2. Create Extensions', icon: '📞' },
              { href: '/dashboard/asterisk/inbound',   label: '3. Map Inbound DIDs',  icon: '📥' },
              { href: '/dashboard/asterisk/audio',     label: '4. Upload IVR Audio',  icon: '🔊' },
            ].map(l => (
              <a
                key={l.href} href={l.href}
                className="flex flex-col items-center gap-1 p-3 rounded-lg bg-secondary hover:bg-secondary/80 transition-colors text-center cursor-pointer"
              >
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
