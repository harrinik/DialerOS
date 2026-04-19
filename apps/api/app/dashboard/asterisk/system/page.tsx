'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Loader2, Terminal, RotateCcw, Cpu } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SystemData {
  version?: string; startupTime?: string;
  coreStatus?: string; moduleCount?: string; sipEndpointSummary?: string;
}
interface CommandResult { ok: boolean; output?: string; error?: string }

const QUICK_ACTIONS = [
  { label: 'Reload Dialplan', action: 'reload_dialplan', icon: '🗺️', color: 'text-primary' },
  { label: 'Reload PJSIP', action: 'reload_pjsip', icon: '☎️', color: 'text-primary' },
  { label: 'Soft Reload All', action: 'reload', icon: '🔄', color: 'text-warning' },
];

export default function SystemInfoPage() {
  const [data, setData] = useState<SystemData | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionPending, setActionPending] = useState('');
  const [actionResult, setActionResult] = useState<CommandResult | null>(null);
  const [cmd, setCmd] = useState('');
  const [cmdResult, setCmdResult] = useState('');
  const [cmdRunning, setCmdRunning] = useState(false);
  const [error, setError] = useState('');

  const token = () => localStorage.getItem('dialer_access_token') ?? '';
  const h = () => ({ Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' });

  const load = () => {
    setLoading(true);
    fetch('/api/asterisk/system', { headers: h() }).then(r => r.json())
      .then((d: { data?: SystemData; error?: string }) => {
        if (d.error) setError(d.error); else setData(d.data ?? null);
      }).finally(() => setLoading(false));
  };
  useEffect(load, []);

  const runAction = async (action: string) => {
    setActionPending(action); setActionResult(null);
    const r = await fetch('/api/asterisk/system', { method: 'POST', headers: h(), body: JSON.stringify({ action }) });
    const d = await r.json() as CommandResult;
    setActionResult(d); setActionPending('');
  };

  const runCmd = async () => {
    if (!cmd.trim()) return;
    setCmdRunning(true); setCmdResult('');
    const r = await fetch('/api/asterisk/ami', { method: 'POST', headers: h(), body: JSON.stringify({ action: 'Command', fields: { Command: cmd } }) });
    const d = await r.json() as { ok: boolean; data: { Output?: string; Message?: string } };
    setCmdResult(d.data?.Output ?? d.data?.Message ?? 'No output');
    setCmdRunning(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold">System Info</h1>
          <p className="text-sm text-muted-foreground mt-1">Asterisk version, module status, and control actions</p></div>
        <Button variant="secondary" size="sm" onClick={load}><RefreshCw className="h-4 w-4" /></Button>
      </div>

      {error && <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>}

      {/* Version card */}
      {data && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground mb-1">Asterisk Version</p>
              <p className="text-lg font-bold font-mono">{data.version ?? '—'}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground mb-1">Uptime Since</p>
              <p className="text-sm font-medium">{data.startupTime ?? '—'}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground mb-1">Modules</p>
              <p className="text-sm font-medium">{data.moduleCount ?? '—'}</p>
            </CardContent>
          </Card>
        </div>
      )}

      {loading && <div className="py-8 text-center text-sm text-muted-foreground">Loading system info…</div>}

      {/* Quick actions */}
      <Card>
        <CardContent className="pt-4">
          <p className="text-sm font-medium mb-3">Quick Actions</p>
          <div className="flex flex-wrap gap-3">
            {QUICK_ACTIONS.map(a => (
              <Button key={a.action} variant="secondary" disabled={!!actionPending}
                onClick={() => void runAction(a.action)}>
                {actionPending === a.action ? <Loader2 className="h-4 w-4 animate-spin" /> : <span>{a.icon}</span>}
                {a.label}
              </Button>
            ))}
          </div>
          {actionResult && (
            <div className={cn('mt-3 rounded-lg px-4 py-2 text-xs font-mono', actionResult.ok ? 'bg-success/10 text-success border border-success/30' : 'bg-destructive/10 text-destructive border border-destructive/30')}>
              {actionResult.output ?? actionResult.error ?? (actionResult.ok ? 'Done' : 'Failed')}
            </div>
          )}
        </CardContent>
      </Card>

      {/* PJSIP endpoint summary */}
      {data?.sipEndpointSummary && (
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm font-medium mb-2 flex items-center gap-2"><Cpu className="h-4 w-4" /> PJSIP Endpoint Summary</p>
            <pre className="text-xs font-mono bg-secondary rounded-lg p-3 overflow-x-auto whitespace-pre">{data.sipEndpointSummary}</pre>
          </CardContent>
        </Card>
      )}

      {/* AMI command console */}
      <Card>
        <CardContent className="pt-4 space-y-3">
          <p className="text-sm font-medium flex items-center gap-2"><Terminal className="h-4 w-4" /> AMI Command Console</p>
          <p className="text-xs text-muted-foreground">Run any Asterisk CLI command via AMI. Examples: <code className="bg-secondary px-1 rounded">core show channels</code>, <code className="bg-secondary px-1 rounded">pjsip show registrations</code></p>
          <div className="flex gap-2">
            <Input className="font-mono text-sm" placeholder="core show version"
              value={cmd} onChange={e => setCmd(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void runCmd(); }} />
            <Button onClick={() => void runCmd()} disabled={cmdRunning || !cmd.trim()}>
              {cmdRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Run'}
            </Button>
          </div>
          {cmdResult && (
            <pre className="text-xs font-mono bg-secondary rounded-lg p-4 overflow-x-auto max-h-80 whitespace-pre">{cmdResult}</pre>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
