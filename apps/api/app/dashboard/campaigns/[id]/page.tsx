'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Phone, CheckCircle2, Play, Pause, ArrowLeft, Calendar, ChevronDown, ChevronRight, AlertCircle, CircleDot, Loader2, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface IvrFlowOption { _id: string; name: string; isDeployed: boolean; }

interface Campaign {
  _id: string; name: string; status: string; callerIdName: string; callerIdNumber: string;
  sipTrunk: string; concurrency: number; amdAction: string; maxRetries: number;
  timezone?: string; startTime?: string; endTime?: string; blackoutDates?: string[];
  stats: { total: number; pending: number; answered: number; machines: number; failed: number; noAnswer: number; busy: number };
  ivrFlowId?: { _id: string; name: string; isDeployed: boolean };
  createdAt: string; updatedAt: string;
}

interface CallTraceEntry {
  at: string;
  step: string;
  level: 'info' | 'success' | 'warning' | 'error';
  title: string;
  detail?: string;
}

interface CallLog {
  _id: string;
  phone: string;
  contactName?: string;
  disposition: string;
  duration?: number;
  amdResult?: string;
  startTime: string;
  failureStage?: string;
  failureReason?: string;
  notes?: string;
  trace?: CallTraceEntry[];
  routedAgent?: { name: string; extension: string } | null;
}

const STATUS_BADGE: Record<string, BadgeProps['variant']> = {
  running: 'running', paused: 'paused', draft: 'draft', completed: 'completed',
};

const OUTCOME_BARS = [
  { key: 'answered', label: 'Answered', class: 'bg-success' },
  { key: 'noAnswer', label: 'No Answer', class: 'bg-muted-foreground' },
  { key: 'machines', label: 'Machine', class: 'bg-warning' },
  { key: 'busy',     label: 'Busy',     class: 'bg-primary' },
  { key: 'failed',   label: 'Failed',   class: 'bg-destructive' },
] as const;

const TRACE_LEVEL_STYLES: Record<CallTraceEntry['level'], string> = {
  info: 'text-primary',
  success: 'text-success',
  warning: 'text-warning',
  error: 'text-destructive',
};

function getDispositionTone(disposition: string): string {
  if (disposition === 'answered') return 'text-success';
  if (disposition === 'failed' || disposition === 'cancelled') return 'text-destructive';
  if (disposition === 'machine' || disposition === 'busy') return 'text-warning';
  return 'text-muted-foreground';
}

function summarizeCall(call: CallLog): string {
  if (call.failureReason) return call.failureReason;
  switch (call.disposition) {
    case 'answered':
      return call.routedAgent?.name
        ? `Answered and routed to ${call.routedAgent.name}.`
        : 'Answered successfully.';
    case 'machine':
      return call.amdResult
        ? `Machine detection result: ${call.amdResult}.`
        : 'A machine or voicemail answered the call.';
    case 'busy':
      return 'The destination reported busy.';
    case 'no_answer':
      return 'The destination never answered before the call ended.';
    case 'failed':
      return call.notes ?? 'The call failed before a stable conversation was established.';
    default:
      return call.notes ?? `Call ended with disposition ${call.disposition.replace(/_/g, ' ')}.`;
  }
}

function getLastErrorTrace(call: CallLog): CallTraceEntry | undefined {
  return [...(call.trace ?? [])].reverse().find((entry) => entry.level === 'error');
}

export default function CampaignDetailPage() {
  const id = (useParams()['id'] as string);
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [recentCalls, setRecentCalls] = useState<CallLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionPending, setActionPending] = useState(false);
  const [blackoutInput, setBlackoutInput] = useState('');
  const [savingCalendar, setSavingCalendar] = useState(false);
  const [calendarForm, setCalendarForm] = useState({ timezone: 'UTC', startTime: '', endTime: '' });
  const [expandedCalls, setExpandedCalls] = useState<Record<string, boolean>>({});
  const [ivrFlows, setIvrFlows] = useState<IvrFlowOption[]>([]);
  const [selectedIvrFlowId, setSelectedIvrFlowId] = useState<string>('');
  const [savingIvr, setSavingIvr] = useState(false);

  const token = () => localStorage.getItem('dialer_access_token') ?? '';

  const fetchCampaign = async () => {
    const r = await fetch(`/api/campaigns/${id}`, { headers: { Authorization: `Bearer ${token()}` } });
    const d = await r.json() as { data: Campaign };
    setCampaign(d.data);
    setBlackoutInput((d.data.blackoutDates ?? []).join(', '));
    setCalendarForm({
      timezone: d.data.timezone ?? 'UTC',
      startTime: d.data.startTime ?? '',
      endTime: d.data.endTime ?? '',
    });
  };

  useEffect(() => {
    Promise.all([
      fetchCampaign(),
      fetch(`/api/call-logs?campaignId=${id}&limit=20`, { headers: { Authorization: `Bearer ${token()}` } })
        .then((r) => r.json() as Promise<{ data: CallLog[] }>)
        .then((d) => {
          const calls = d.data ?? [];
          setRecentCalls(calls);
          setExpandedCalls((prev) => ({
            ...Object.fromEntries(calls
              .filter((call) => prev[call._id] || call.disposition === 'failed' || Boolean(call.failureReason))
              .map((call) => [call._id, true])),
            ...prev,
          }));
        }),
    ]).finally(() => setLoading(false));
  }, [id]);

  // Auto-poll every 5 s while the campaign is actively running
  useEffect(() => {
    if (campaign?.status !== 'running') return;
    const interval = setInterval(() => { void fetchCampaign(); }, 5000);
    return () => clearInterval(interval);
  }, [campaign?.status, id]);

  // Sync IVR picker when campaign loads
  useEffect(() => {
    if (campaign) setSelectedIvrFlowId(campaign.ivrFlowId?._id ?? '');
  }, [campaign?._id]);

  // Fetch available IVR flows for the picker
  useEffect(() => {
    fetch('/api/ivr-flows', { headers: { Authorization: `Bearer ${token()}` } })
      .then((r) => r.json() as Promise<{ data: IvrFlowOption[] }>)
      .then((d) => setIvrFlows(d.data ?? []))
      .catch(() => null);
  }, []);

  const [ivrSaveError, setIvrSaveError] = useState<string | null>(null);
  const [ivrSaveOk, setIvrSaveOk] = useState(false);

  const saveIvrFlow = async () => {
    setSavingIvr(true); setIvrSaveError(null); setIvrSaveOk(false);
    try {
      const r = await fetch(`/api/campaigns/${id}/ivr`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ivrFlowId: selectedIvrFlowId || null }),
      });
      const d = await r.json() as { error?: string };
      if (!r.ok) { setIvrSaveError(d.error ?? 'Save failed'); return; }
      setIvrSaveOk(true);
      setTimeout(() => setIvrSaveOk(false), 3000);
      await fetchCampaign();
    } catch (err) {
      setIvrSaveError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setSavingIvr(false);
    }
  };

  const handleRestart = async () => {
    if (!campaign) return;
    if (!confirm('Re-dial all completed/failed contacts and restart the campaign?')) return;
    setActionPending(true);
    try {
      await fetch(`/api/campaigns/${id}/restart`, { method: 'POST', headers: { Authorization: `Bearer ${token()}` } });
      await fetchCampaign();
    } finally {
      setActionPending(false);
    }
  };

  const handleToggle = async () => {
    if (!campaign) return;
    setActionPending(true);
    const action = campaign.status === 'running' ? 'pause' : 'start';
    try {
      await fetch(`/api/campaigns/${id}/${action}`, { method: 'POST', headers: { Authorization: `Bearer ${token()}` } });
      await fetchCampaign();
    } finally { setActionPending(false); }
  };

  const saveCalendar = async () => {
    if (!campaign) return;
    setSavingCalendar(true);
    try {
      const blackoutDates = blackoutInput
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
      const response = await fetch(`/api/campaigns/${id}/calendar`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timezone: calendarForm.timezone,
          startTime: calendarForm.startTime || null,
          endTime: calendarForm.endTime || null,
          blackoutDates,
        }),
      });
      if (!response.ok) {
        throw new Error('Failed to save calendar settings');
      }
      await fetchCampaign();
    } finally {
      setSavingCalendar(false);
    }
  };

  if (loading) return <div className="flex items-center justify-center py-32 text-muted-foreground text-sm">Loading campaign...</div>;
  if (!campaign) return (
    <div className="flex flex-col items-center justify-center py-32 gap-4">
      <p className="text-destructive text-sm">Campaign not found</p>
      <Link href="/dashboard/campaigns"><Button variant="secondary">← Back</Button></Link>
    </div>
  );

  const total = campaign.stats.total || 1;
  const answerRate = campaign.stats.total > 0 ? ((campaign.stats.answered / campaign.stats.total) * 100).toFixed(1) : '0.0';
  const dialedPct = campaign.stats.total > 0
    ? Math.min(100, ((campaign.stats.answered + campaign.stats.machines + campaign.stats.failed + campaign.stats.busy + campaign.stats.noAnswer) / campaign.stats.total) * 100)
    : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <Link href="/dashboard/campaigns" className="text-muted-foreground hover:text-foreground transition-colors text-sm">
              <ArrowLeft className="inline h-3.5 w-3.5 mr-0.5" /> Campaigns
            </Link>
            <span className="text-muted-foreground">/</span>
            <h1 className="text-2xl font-bold tracking-tight">{campaign.name}</h1>
            <Badge variant={STATUS_BADGE[campaign.status] ?? 'draft'}>{campaign.status}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">{campaign.callerIdName} · {campaign.callerIdNumber} · {campaign.sipTrunk}</p>
        </div>
        <div className="flex items-center gap-2">
          {campaign.status !== 'completed' && campaign.status !== 'archived' && (
            <Button disabled={actionPending} variant={campaign.status === 'running' ? 'secondary' : 'default'}
              onClick={() => void handleToggle()}>
              {campaign.status === 'running'
                ? <><Pause className="h-4 w-4" /> Pause</>
                : <><Play className="h-4 w-4 fill-current" /> Start</>
              }
            </Button>
          )}
          {(campaign.status === 'completed' || campaign.status === 'paused' || campaign.status === 'archived') && (
            <Button disabled={actionPending} variant="secondary" onClick={() => void handleRestart()}>
              <RotateCcw className="h-4 w-4" /> Restart
            </Button>
          )}
        </div>
      </div>

      {/* Running / processing banner */}
      {campaign.status === 'running' && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-primary">
            <Loader2 className="h-4 w-4 animate-spin" />
            Campaign is dialing — live stats refresh every 5 seconds
          </div>
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Progress</span>
              <span>{dialedPct.toFixed(1)}% of {campaign.stats.total.toLocaleString()} contacts dialed</span>
            </div>
            <Progress value={dialedPct} className="h-1.5" />
          </div>
          <p className="text-xs text-muted-foreground">
            {campaign.stats.pending > 0
              ? `${campaign.stats.pending.toLocaleString()} contacts still pending. Campaign will auto-complete when all are processed.`
              : 'All contacts have been dispatched. Waiting for active calls to finish…'}
          </p>
        </div>
      )}
      {campaign.status === 'completed' && (
        <div className="rounded-lg border border-success/30 bg-success/5 px-4 py-3 flex items-center gap-2 text-sm text-success">
          <CheckCircle2 className="h-4 w-4" />
          Campaign completed — all contacts have been processed.
        </div>
      )}

      {/* KPI row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Total Contacts', value: campaign.stats.total.toLocaleString(), icon: Phone, color: 'text-primary' },
          { label: 'Answered', value: campaign.stats.answered.toLocaleString(), icon: CheckCircle2, color: 'text-success' },
          { label: 'Answer Rate', value: `${answerRate}%`, icon: CheckCircle2, color: 'text-success' },
          { label: 'Pending', value: campaign.stats.pending.toLocaleString(), icon: Phone, color: 'text-warning' },
        ].map((k) => {
          const Icon = k.icon;
          return (
            <Card key={k.label}><CardContent className="pt-6">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">{k.label}</p>
                  <p className={`text-3xl font-bold mt-1 tabular-nums ${k.color}`}>{k.value}</p>
                </div>
                <div className={`rounded-lg bg-secondary p-2 ${k.color}`}><Icon className="h-4 w-4" /></div>
              </div>
            </CardContent></Card>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Outcome breakdown */}
        <Card>
          <CardHeader><CardTitle className="text-base">Outcome Breakdown</CardTitle></CardHeader>
          <Separator />
          <CardContent className="pt-4 space-y-3">
            {OUTCOME_BARS.map(({ key, label, class: barClass }) => {
              const val = campaign.stats[key as keyof typeof campaign.stats] as number;
              const pct = total > 0 ? (val / total) * 100 : 0;
              return (
                <div key={key}>
                  <div className="flex justify-between text-sm mb-1.5">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="font-mono text-xs text-muted-foreground">{val} · {pct.toFixed(1)}%</span>
                  </div>
                  <Progress value={pct} indicatorClassName={barClass} />
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* Configuration */}
        <Card>
          <CardHeader><CardTitle className="text-base">Configuration</CardTitle></CardHeader>
          <Separator />
          <CardContent className="pt-4 space-y-3">
            <div className="space-y-2">
              {[
                ['Concurrency', `${campaign.concurrency}× simultaneous`],
                ['AMD Action', campaign.amdAction],
                ['Max Retries', String(campaign.maxRetries)],
                ['Caller ID', `${campaign.callerIdName} <${campaign.callerIdNumber}>`],
                ['SIP Trunk', campaign.sipTrunk],
              ].map(([k, v]) => (
                <div key={k} className="rounded-md border border-border/60 px-3 py-2 sm:grid sm:grid-cols-[10rem_1fr] sm:gap-3">
                  <p className="text-xs text-muted-foreground">{k}</p>
                  <p className="break-all text-xs font-mono text-foreground">{v}</p>
                </div>
              ))}
            </div>
            {/* IVR Flow picker */}
            <div className="rounded-md border border-border/60 px-3 py-2 space-y-2">
              <p className="text-xs text-muted-foreground">IVR Flow</p>
              <div className="flex items-center gap-2">
                <Select value={selectedIvrFlowId} onValueChange={(v) => setSelectedIvrFlowId(v === 'none' ? '' : v)}>
                  <SelectTrigger className="h-8 text-xs flex-1">
                    <SelectValue placeholder="No IVR — direct routing" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No IVR — direct routing</SelectItem>
                    {ivrFlows.map((f) => (
                      <SelectItem key={f._id} value={f._id}>
                        {f.name}{f.isDeployed ? '' : ' (draft)'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button size="sm" variant="secondary" className="h-8 text-xs" disabled={savingIvr} onClick={() => void saveIvrFlow()}>
                  {savingIvr ? 'Saving…' : 'Save'}
                </Button>
              </div>
              {ivrSaveOk && <p className="text-xs text-success">✓ IVR flow saved</p>}
              {ivrSaveError && <p className="text-xs text-destructive">{ivrSaveError}</p>}
              <p className="text-xs text-muted-foreground">
                Callers hear this IVR on answer. Build flows in the{' '}
                <a href="/dashboard/ivr-builder" className="underline text-primary">IVR Builder</a>.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Calendar className="h-4 w-4 text-primary" /> Blackout Calendar
          </CardTitle>
        </CardHeader>
        <Separator />
        <CardContent className="pt-4 space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Timezone</Label>
              <Input
                value={calendarForm.timezone}
                onChange={(e) => setCalendarForm((prev) => ({ ...prev, timezone: e.target.value }))}
                placeholder="UTC"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Daily Start</Label>
              <Input
                type="time"
                value={calendarForm.startTime}
                onChange={(e) => setCalendarForm((prev) => ({ ...prev, startTime: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Daily End</Label>
              <Input
                type="time"
                value={calendarForm.endTime}
                onChange={(e) => setCalendarForm((prev) => ({ ...prev, endTime: e.target.value }))}
              />
            </div>
          </div>
          <Input
            value={blackoutInput}
            onChange={(e) => setBlackoutInput(e.target.value)}
            placeholder="2026-12-25, 2026-01-01"
          />
          <p className="text-xs text-muted-foreground">
            Comma-separated dates in YYYY-MM-DD. Calls are blocked for the full date in campaign timezone.
          </p>
          <Button size="sm" variant="secondary" disabled={savingCalendar} onClick={() => void saveCalendar()}>
            {savingCalendar ? 'Saving...' : 'Save Calendar'}
          </Button>
        </CardContent>
      </Card>

      {/* Recent calls */}
      <Card>
        <CardHeader><CardTitle className="text-base">Recent Calls</CardTitle></CardHeader>
        <Separator />
        <CardContent className="px-0 pt-0">
          {recentCalls.length === 0 ? (
            <p className="text-center text-muted-foreground py-10 text-sm">No calls recorded yet</p>
          ) : (
            <>
              <div className="divide-y divide-border/60">
              {recentCalls.map((c) => {
                const expanded = expandedCalls[c._id] ?? false;
                const lastError = getLastErrorTrace(c);
                const summary = summarizeCall(c);

                return (
                  <div key={c._id} className="px-4 py-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-mono text-sm text-foreground">{c.phone || 'Unknown number'}</p>
                          <Badge variant="outline" className={cn('capitalize', getDispositionTone(c.disposition))}>
                            {c.disposition.replace(/_/g, ' ')}
                          </Badge>
                          {c.failureStage && (
                            <Badge variant="secondary" className="font-mono text-[10px] uppercase tracking-wide">
                              {c.failureStage.replace(/_/g, ' ')}
                            </Badge>
                          )}
                          {c.amdResult && (
                            <Badge variant="secondary" className="font-mono text-[10px]">
                              AMD {c.amdResult}
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-foreground">{summary}</p>
                        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                          {c.contactName && <span>Contact: {c.contactName}</span>}
                          <span>Time: {new Date(c.startTime).toLocaleString()}</span>
                          <span>
                            Duration: {c.duration != null ? `${Math.floor(c.duration / 60)}m ${c.duration % 60}s` : '—'}
                          </span>
                          {c.routedAgent?.name && (
                            <span>Agent: {c.routedAgent.name}{c.routedAgent.extension ? ` (${c.routedAgent.extension})` : ''}</span>
                          )}
                        </div>
                      </div>

                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setExpandedCalls((prev) => ({ ...prev, [c._id]: !expanded }))}
                        className="self-start"
                      >
                        {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        {expanded ? 'Hide Trace' : 'Show Trace'}
                      </Button>
                    </div>

                    {expanded && (
                      <div className="mt-4 space-y-4 rounded-md border border-border/60 bg-secondary/20 p-4">
                        {(c.failureReason || lastError) && (
                          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
                            <div className="flex items-start gap-2">
                              <AlertCircle className="mt-0.5 h-4 w-4 text-destructive" />
                              <div className="space-y-1 text-sm">
                                <p className="font-medium text-foreground">Failure Summary</p>
                                <p className="text-foreground">{c.failureReason ?? summary}</p>
                                {lastError?.detail && lastError.detail !== c.failureReason && (
                                  <p className="font-mono text-xs text-muted-foreground">{lastError.detail}</p>
                                )}
                              </div>
                            </div>
                          </div>
                        )}

                        {c.trace && c.trace.length > 0 ? (
                          <div className="space-y-3">
                            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Trace Timeline</p>
                            {c.trace.map((entry, index) => (
                              <div key={`${c._id}-${entry.at}-${index}`} className="flex gap-3">
                                <div className="flex flex-col items-center">
                                  <CircleDot className={cn('mt-0.5 h-4 w-4', TRACE_LEVEL_STYLES[entry.level])} />
                                  {index < (c.trace?.length ?? 0) - 1 && <div className="mt-1 h-full w-px bg-border" />}
                                </div>
                                <div className="min-w-0 flex-1 pb-2">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <p className="text-sm font-medium text-foreground">{entry.title}</p>
                                    <span className="text-[11px] text-muted-foreground">
                                      {new Date(entry.at).toLocaleTimeString()}
                                    </span>
                                  </div>
                                  <p className="mt-1 text-xs text-muted-foreground">{entry.detail ?? entry.step}</p>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground">
                            No detailed trace was recorded for this call. New calls will show a step-by-step trace.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {false && (<Table className="min-w-190">
              <TableHeader>
                <TableRow>
                  <TableHead>Phone</TableHead><TableHead>Disposition</TableHead>
                  <TableHead>AMD</TableHead><TableHead>Duration</TableHead><TableHead>Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentCalls.map((c) => (
                  <TableRow key={c._id}>
                    <TableCell className="font-mono text-xs">{c.phone}</TableCell>
                    <TableCell>
                      <span className={cn('text-xs capitalize',
                        c.disposition === 'answered' ? 'text-success' :
                        c.disposition === 'failed' ? 'text-destructive' : 'text-muted-foreground',
                      )}>
                        {c.disposition?.replace(/_/g, ' ')}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{c.amdResult ?? '—'}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {c.duration != null ? `${Math.floor(c.duration / 60)}m ${c.duration % 60}s` : '—'}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(c.startTime).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>)}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
