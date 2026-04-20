'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useAuth } from '@/lib/auth/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  RefreshCw, Loader2, Terminal, CheckCircle2, XCircle,
  AlertTriangle, Info, Zap, Activity, ChevronDown, ChevronRight,
  Play, Cpu,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Types ────────────────────────────────────────────────────────────────────

interface DiagStep {
  step: number;
  label: string;
  status: 'ok' | 'fail' | 'warn' | 'skip';
  detail: string;
  hint?: string;
  durationMs?: number;
}

interface DiagReport {
  timestamp: string;
  overallOk: boolean;
  ari: DiagStep[];
  ami: DiagStep[];
}

interface LogEntry {
  id: number;
  ts: Date;
  level: 'info' | 'warn' | 'error' | 'debug' | 'system';
  category: string;
  message: string;
}

interface SystemInfo {
  version?: string;
  startupTime?: string;
  coreStatus?: string;
  moduleCount?: string;
  sipEndpointSummary?: string;
}

let LOG_ID = 0;
const MAX_LOGS = 500;

// ── Sub-components ────────────────────────────────────────────────────────────

function StatusIcon({ status }: { status: DiagStep['status'] }) {
  if (status === 'ok')   return <CheckCircle2 className="h-4 w-4 text-success shrink-0 mt-0.5" />;
  if (status === 'fail') return <XCircle       className="h-4 w-4 text-destructive shrink-0 mt-0.5" />;
  if (status === 'warn') return <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />;
  return                        <Info          className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />;
}

function DiagStepRow({ step }: { step: DiagStep }) {
  const [open, setOpen] = useState(step.status === 'fail' || step.status === 'warn');
  const hasHint = !!step.hint;

  return (
    <div className={cn(
      'rounded-lg border px-4 py-3',
      step.status === 'ok'   && 'border-success/20 bg-success/5',
      step.status === 'fail' && 'border-destructive/30 bg-destructive/5',
      step.status === 'warn' && 'border-warning/30 bg-warning/5',
      step.status === 'skip' && 'border-border/50 bg-muted/20',
    )}>
      <div className="flex items-start gap-3 cursor-pointer" onClick={() => hasHint && setOpen(v => !v)}>
        <StatusIcon status={step.status} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">
              Step {step.step}: {step.label}
            </span>
            <div className="flex items-center gap-2 shrink-0">
              {step.durationMs != null && (
                <span className="text-[10px] text-muted-foreground font-mono">{step.durationMs}ms</span>
              )}
              {hasHint && (
                open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                     : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
              )}
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 font-mono">{step.detail}</p>
        </div>
      </div>
      {open && step.hint && (
        <div className="mt-3 ml-7 rounded-md bg-black/30 border border-white/5 px-3 py-2.5">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5 font-semibold">How to fix</p>
          <pre className="text-xs text-foreground/80 font-mono whitespace-pre-wrap leading-relaxed">{step.hint}</pre>
        </div>
      )}
    </div>
  );
}

function LogLevelBadge({ level }: { level: LogEntry['level'] }) {
  return (
    <span className={cn(
      'inline-block w-12 text-center text-[9px] font-bold uppercase tracking-wider rounded px-1 py-0.5',
      level === 'error'  && 'bg-destructive/20 text-destructive',
      level === 'warn'   && 'bg-warning/20 text-warning',
      level === 'info'   && 'bg-primary/15 text-primary',
      level === 'debug'  && 'bg-muted text-muted-foreground',
      level === 'system' && 'bg-success/15 text-success',
    )}>
      {level}
    </span>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function SystemInfoPage() {
  const { accessToken } = useAuth();
  const h = useCallback(() => ({
    Authorization: `Bearer ${accessToken ?? ''}`,
    'Content-Type': 'application/json',
  }), [accessToken]);

  // Diag state
  const [diag, setDiag]               = useState<DiagReport | null>(null);
  const [diagRunning, setDiagRunning] = useState(false);
  const [diagError, setDiagError]     = useState<string | null>(null);

  // System info state (quick stats)
  const [sysInfo, setSysInfo]   = useState<SystemInfo | null>(null);
  const [sysLoading, setSysLoading] = useState(true);

  // Live logs
  const [logs, setLogs]             = useState<LogEntry[]>([]);
  const [logFilter, setLogFilter]   = useState<LogEntry['level'] | 'all'>('all');
  const [logPaused, setLogPaused]   = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const logsPausedRef = useRef(false);
  logsPausedRef.current = logPaused;

  // AMI console
  const [cmd, setCmd]           = useState('');
  const [cmdResult, setCmdResult] = useState('');
  const [cmdRunning, setCmdRunning] = useState(false);

  // Action state
  const [actionPending, setActionPending] = useState('');
  const [actionResult, setActionResult]   = useState<{ ok: boolean; output?: string; error?: string } | null>(null);

  // ── Helpers ──────────────────────────────────────────────────────────────

  const addLog = useCallback((level: LogEntry['level'], category: string, message: string) => {
    const entry: LogEntry = { id: ++LOG_ID, ts: new Date(), level, category, message };
    setLogs(prev => [...prev, entry].slice(-MAX_LOGS));
  }, []);

  // ── Load system info ──────────────────────────────────────────────────────

  const loadSysInfo = useCallback(() => {
    setSysLoading(true);
    addLog('system', 'Dashboard', 'Fetching Asterisk system info…');
    fetch('/api/asterisk/system', { headers: h() })
      .then(r => r.json() as Promise<{ data?: SystemInfo; error?: string }>)
      .then(d => {
        if (d.error) {
          addLog('error', 'System', `System info error: ${d.error}`);
        } else {
          setSysInfo(d.data ?? null);
          addLog('info', 'System', `Asterisk ${d.data?.version ?? 'unknown'} — ${d.data?.moduleCount ?? ''}`);
        }
      })
      .catch(e => addLog('error', 'System', `Fetch failed: ${String(e)}`))
      .finally(() => setSysLoading(false));
  }, [h, addLog]);

  useEffect(() => { loadSysInfo(); }, [loadSysInfo]);

  // ── Auto-scroll logs ──────────────────────────────────────────────────────
  useEffect(() => {
    if (autoScroll && !logPaused) {
      logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll, logPaused]);

  // ── Poll AMI events every 5s (simulated via quick commands) ──────────────
  useEffect(() => {
    const poll = async () => {
      if (logsPausedRef.current) return;
      try {
        const r = await fetch('/api/asterisk/ami', {
          method: 'POST',
          headers: h(),
          body: JSON.stringify({ action: 'Command', fields: { Command: 'core show channels concise' } }),
        });
        if (!r.ok) return;
        const d = await r.json() as { ok: boolean; data?: { Output?: string } };
        if (d.ok && d.data?.Output) {
          const lines = d.data.Output.trim().split('\n').filter(Boolean);
          addLog('info', 'Channels', lines.length > 0
            ? `${lines.length} active channel(s): ${lines.slice(0, 3).join(', ')}${lines.length > 3 ? '…' : ''}`
            : 'No active channels');
        }
      } catch { /* silent — AMI may not be connected */ }
    };
    const t = setInterval(poll, 8000);
    return () => clearInterval(t);
  }, [h, addLog]);

  // ── Run full diagnostics ──────────────────────────────────────────────────
  const runDiag = async () => {
    setDiagRunning(true);
    setDiagError(null);
    setDiag(null);
    addLog('system', 'Diagnostics', 'Starting full connection diagnostics…');

    try {
      const r = await fetch('/api/asterisk/diagnostics', {
        method: 'POST', headers: h(),
        signal: AbortSignal.timeout(45_000),
      });
      const d = await r.json() as DiagReport;
      setDiag(d);

      const failedAri = d.ari.filter(s => s.status === 'fail');
      const failedAmi = d.ami.filter(s => s.status === 'fail');

      addLog(d.overallOk ? 'info' : 'error', 'Diagnostics',
        d.overallOk
          ? `All checks passed — ARI ${d.ari.length} steps OK, AMI ${d.ami.length} steps OK`
          : [
              ...failedAri.map(s => `ARI Step ${s.step} (${s.label}): ${s.detail}`),
              ...failedAmi.map(s => `AMI Step ${s.step} (${s.label}): ${s.detail}`),
            ].join(' | '));
    } catch (e) {
      const msg = e instanceof DOMException && e.name === 'AbortError'
        ? 'Diagnostics timed out (45s)' : String(e);
      setDiagError(msg);
      addLog('error', 'Diagnostics', msg);
    } finally {
      setDiagRunning(false);
    }
  };

  // ── AMI Quick Actions ─────────────────────────────────────────────────────
  const runAction = async (action: string, label: string) => {
    setActionPending(action); setActionResult(null);
    addLog('system', 'Action', `Running: ${label}`);
    try {
      const r = await fetch('/api/asterisk/system', {
        method: 'POST', headers: h(), body: JSON.stringify({ action }),
      });
      const d = await r.json() as { ok: boolean; output?: string; error?: string };
      setActionResult(d);
      addLog(d.ok ? 'info' : 'error', 'Action', d.ok
        ? `${label} completed: ${d.output?.slice(0, 120) ?? 'done'}`
        : `${label} failed: ${d.error ?? 'unknown error'}`);
    } catch (e) {
      addLog('error', 'Action', `${label} threw: ${String(e)}`);
    } finally {
      setActionPending('');
    }
  };

  // ── AMI Console ──────────────────────────────────────────────────────────
  const runCmd = async () => {
    if (!cmd.trim()) return;
    setCmdRunning(true); setCmdResult('');
    addLog('debug', 'Console', `> ${cmd}`);
    try {
      const r = await fetch('/api/asterisk/ami', {
        method: 'POST', headers: h(),
        body: JSON.stringify({ action: 'Command', fields: { Command: cmd } }),
      });
      const d = await r.json() as { ok: boolean; data?: { Output?: string; Message?: string; error?: string } };
      const output = d.data?.Output ?? d.data?.Message ?? d.data?.error ?? 'No output';
      setCmdResult(output);
      addLog(d.ok ? 'info' : 'error', 'Console', output.split('\n')[0]?.slice(0, 120) ?? 'done');
    } catch (e) {
      const msg = String(e);
      setCmdResult(msg);
      addLog('error', 'Console', msg);
    } finally {
      setCmdRunning(false);
    }
  };

  // ── Visible logs ─────────────────────────────────────────────────────────
  const visibleLogs = logFilter === 'all' ? logs : logs.filter(l => l.level === logFilter);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Activity className="h-6 w-6 text-primary" /> System Diagnostics & Logs
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Real-time Asterisk health checks, step-by-step diagnostics, and live event log
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={loadSysInfo} disabled={sysLoading}>
            {sysLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {/* Quick stats */}
      {sysInfo && (
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            { label: 'Asterisk Version', value: sysInfo.version ?? '—' },
            { label: 'Up Since',         value: sysInfo.startupTime ?? '—' },
            { label: 'PJSIP Modules',    value: sysInfo.moduleCount ?? '—' },
          ].map(({ label, value }) => (
            <Card key={label}>
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="text-sm font-bold font-mono mt-0.5">{value}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {sysLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading system info…
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">

        {/* ── Diagnostics Panel ─────────────────────────────────────────── */}
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Zap className="h-4 w-4 text-primary" /> Connection Diagnostics
                </CardTitle>
                <div className="flex items-center gap-3">
                  {diag && (
                    <Badge variant={diag.overallOk ? 'running' : 'destructive'} className="text-xs">
                      {diag.overallOk ? '✓ All Checks Passed' : '✗ Issues Found'}
                    </Badge>
                  )}
                  <Button size="sm" onClick={() => void runDiag()} disabled={diagRunning}>
                    {diagRunning
                      ? <><Loader2 className="h-4 w-4 animate-spin" /> Running…</>
                      : <><Play className="h-4 w-4 fill-current" /> Run Full Diagnostics</>}
                  </Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Tests each layer of the ARI and AMI connection with actionable error context. Click any failed step for fix instructions.
              </p>
            </CardHeader>
            <Separator />
            <CardContent className="pt-4">
              {diagError && (
                <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                  {diagError}
                </div>
              )}

              {!diag && !diagRunning && (
                <div className="text-center py-10 text-muted-foreground text-sm">
                  <Zap className="h-8 w-8 mx-auto mb-2 text-muted-foreground/30" />
                  Click <strong>Run Full Diagnostics</strong> to test ARI and AMI connections step by step with detailed error context.
                </div>
              )}

              {diagRunning && (
                <div className="flex flex-col items-center justify-center py-10 gap-3 text-muted-foreground">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  <p className="text-sm">Running TCP probes, auth checks, and Asterisk health…</p>
                  <p className="text-xs">This may take up to 30 seconds</p>
                </div>
              )}

              {diag && (
                <div className="grid gap-6 lg:grid-cols-2">
                  {/* ARI */}
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-2">
                      <span className="h-1.5 w-1.5 rounded-full bg-primary inline-block" /> ARI (REST Interface)
                    </p>
                    <div className="space-y-2">
                      {diag.ari.map(s => <DiagStepRow key={s.step} step={s} />)}
                      {diag.ari.length === 0 && (
                        <p className="text-xs text-muted-foreground italic">No ARI steps recorded</p>
                      )}
                    </div>
                  </div>
                  {/* AMI */}
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-2">
                      <span className="h-1.5 w-1.5 rounded-full bg-accent inline-block" /> AMI (Manager Interface)
                    </p>
                    <div className="space-y-2">
                      {diag.ami.map(s => <DiagStepRow key={s.step} step={s} />)}
                      {diag.ami.length === 0 && (
                        <p className="text-xs text-muted-foreground italic">No AMI steps recorded</p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {diag && (
                <p className="text-[10px] text-muted-foreground mt-4 text-right">
                  Last run: {new Date(diag.timestamp).toLocaleTimeString()}
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── Live Log Viewer ────────────────────────────────────────────── */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Terminal className="h-4 w-4 text-primary" /> Live Event Log
                  <Badge variant="secondary" className="font-mono text-xs">{visibleLogs.length}/{MAX_LOGS}</Badge>
                </CardTitle>
                <div className="flex items-center gap-2 flex-wrap">
                  {(['all', 'error', 'warn', 'info', 'debug', 'system'] as const).map(l => (
                    <button
                      key={l}
                      onClick={() => setLogFilter(l)}
                      className={cn(
                        'text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded transition-colors border',
                        logFilter === l
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'border-border text-muted-foreground hover:border-primary/50',
                      )}
                    >
                      {l}
                    </button>
                  ))}
                  <Button
                    size="sm" variant={logPaused ? 'default' : 'secondary'}
                    onClick={() => setLogPaused(v => !v)}
                    className="text-xs h-7"
                  >
                    {logPaused ? '▶ Resume' : '⏸ Pause'}
                  </Button>
                  <Button
                    size="sm" variant="ghost"
                    onClick={() => setLogs([])}
                    className="text-xs h-7 text-muted-foreground"
                  >
                    Clear
                  </Button>
                </div>
              </div>
            </CardHeader>
            <Separator />
            <CardContent className="pt-0 px-0">
              <div
                className="h-72 overflow-auto font-mono text-xs bg-black/40 rounded-b-lg"
                onScroll={(e) => {
                  const el = e.currentTarget;
                  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
                  setAutoScroll(atBottom);
                }}
              >
                {visibleLogs.length === 0 ? (
                  <div className="flex items-center justify-center h-full text-muted-foreground text-xs">
                    No log entries yet — run diagnostics or AMI commands to see output here
                  </div>
                ) : (
                  <table className="w-full min-w-180">
                    <tbody>
                      {visibleLogs.map(entry => (
                        <tr
                          key={entry.id}
                          className={cn(
                            'border-b border-white/5 hover:bg-white/3',
                            entry.level === 'error' && 'bg-destructive/5',
                            entry.level === 'warn'  && 'bg-warning/5',
                          )}
                        >
                          <td className="w-20 whitespace-nowrap py-1 pl-4 pr-2 text-[10px] text-muted-foreground/60">
                            {entry.ts.toLocaleTimeString()}
                          </td>
                          <td className="pr-3 py-1 whitespace-nowrap">
                            <LogLevelBadge level={entry.level} />
                          </td>
                          <td className="w-24 whitespace-nowrap py-1 pr-3 text-[10px] text-muted-foreground/70">
                            {entry.category}
                          </td>
                          <td className="py-1 pr-4 leading-relaxed text-foreground/80 whitespace-pre-wrap break-all">
                            {entry.message}
                          </td>
                        </tr>
                      ))}
                      <tr><td colSpan={4}><div ref={logsEndRef} /></td></tr>
                    </tbody>
                  </table>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ── Quick Actions ──────────────────────────────────────────────── */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <RefreshCw className="h-4 w-4 text-primary" /> Quick Actions
            </CardTitle>
          </CardHeader>
          <Separator />
          <CardContent className="pt-4">
            <div className="flex flex-wrap gap-2">
              {[
                { label: 'Reload Dialplan', action: 'reload_dialplan' },
                { label: 'Reload PJSIP',    action: 'reload_pjsip' },
                { label: 'Soft Reload All', action: 'reload' },
              ].map(a => (
                <Button key={a.action} variant="secondary" size="sm" disabled={!!actionPending}
                  onClick={() => void runAction(a.action, a.label)}>
                  {actionPending === a.action
                    ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />{a.label}</>
                    : a.label}
                </Button>
              ))}
            </div>
            {actionResult && (
              <div className={cn(
                'mt-3 rounded-lg border px-3 py-2 text-xs font-mono whitespace-pre-wrap',
                actionResult.ok
                  ? 'border-success/30 bg-success/5 text-success'
                  : 'border-destructive/30 bg-destructive/5 text-destructive',
              )}>
                {actionResult.output ?? actionResult.error ?? (actionResult.ok ? 'OK' : 'Failed')}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── AMI Console ────────────────────────────────────────────────── */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Cpu className="h-4 w-4 text-primary" /> AMI Command Console
            </CardTitle>
          </CardHeader>
          <Separator />
          <CardContent className="pt-4 space-y-3">
            <p className="text-xs text-muted-foreground">
              Run any Asterisk CLI command via AMI. Output appears here and in the log viewer.
            </p>
            <div className="flex flex-wrap gap-2">
              <Input
                className="font-mono text-sm"
                placeholder="core show version"
                value={cmd}
                onChange={e => setCmd(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') void runCmd(); }}
              />
              <Button onClick={() => void runCmd()} disabled={cmdRunning || !cmd.trim()}>
                {cmdRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Run'}
              </Button>
            </div>
            <div className="text-[10px] text-muted-foreground flex flex-wrap gap-2">
              {['core show version', 'core show channels', 'pjsip show endpoints', 'manager show users', 'core show uptime'].map(c => (
                <button key={c} onClick={() => setCmd(c)}
                  className="bg-secondary rounded px-1.5 py-0.5 font-mono hover:bg-primary/10 transition-colors">
                  {c}
                </button>
              ))}
            </div>
            {cmdResult && (
              <pre className="text-xs font-mono bg-black/40 rounded-lg p-4 overflow-x-auto max-h-48 whitespace-pre border border-white/5">
                {cmdResult}
              </pre>
            )}
          </CardContent>
        </Card>

      </div>
    </div>
  );
}
