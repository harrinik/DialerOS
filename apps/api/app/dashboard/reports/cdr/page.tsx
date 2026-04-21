'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useAuth } from '@/lib/auth/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import {
  RefreshCw, Loader2, Phone, PhoneOff, PhoneIncoming, PhoneOutgoing,
  ArrowLeft, ArrowRight, Filter, ChevronDown, ChevronRight,
  Wifi, WifiOff, Circle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Types ──────────────────────────────────────────────────────────────────────

interface CdrRecord {
  _id:              string;
  uniqueId:         string;
  src:              string;
  dst:              string;
  callerIdName:     string;
  callerIdNum:      string;
  channel:          string;
  destChannel:      string;
  dstContext:       string;
  lastApp:          string;
  startTime:        string;
  answerTime?:      string;
  endTime:          string;
  duration:         number;
  billableSeconds:  number;
  disposition:      string;
  type:             'internal' | 'outbound' | 'inbound' | 'campaign';
}

interface StatBucket { _id: string; count: number; totalSecs: number; avgDuration: number }

// ── Campaign Call Log types ────────────────────────────────────────────────────

interface TraceEntry {
  at: string;
  step: string;
  level: 'info' | 'success' | 'warning' | 'error';
  title: string;
  detail?: string;
}

interface DtmfEntry { digit: string; receivedAt: string }

interface CallLogRecord {
  _id: string;
  channelId: string;
  uniqueId: string;
  startTime: string;
  answerTime?: string;
  endTime?: string;
  duration?: number;
  disposition: string;
  amdResult?: string;
  attempt: number;
  failureStage?: string;
  failureReason?: string;
  dtmfSequence: DtmfEntry[];
  trace: TraceEntry[];
  phone: string;
  contactName: string;
  routedAgent?: { name: string; extension: string } | null;
  campaignId: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtSec(s: number) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function fmtDateShort(iso: string) {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const DISP_COLORS: Record<string, string> = {
  ANSWERED:    'text-success',
  'NO ANSWER': 'text-muted-foreground',
  BUSY:        'text-warning',
  FAILED:      'text-destructive',
  CONGESTION:  'text-destructive',
};

const TYPE_ICONS: Record<string, React.ReactNode> = {
  internal: <Phone className="h-3.5 w-3.5 text-primary" />,
  inbound:  <PhoneIncoming className="h-3.5 w-3.5 text-success" />,
  outbound: <PhoneOutgoing className="h-3.5 w-3.5 text-warning" />,
  campaign: <PhoneOutgoing className="h-3.5 w-3.5 text-primary" />,
};

const LOG_DISP: Record<string, string> = {
  answered: 'text-success', machine: 'text-warning', busy: 'text-warning',
  no_answer: 'text-muted-foreground', failed: 'text-destructive',
  cancelled: 'text-muted-foreground', voicemail: 'text-primary',
};

const TRACE_STYLE: Record<string, { dot: string; bar: string; text: string }> = {
  success: { dot: 'bg-success border-success',          bar: 'bg-success/30',      text: 'text-success' },
  info:    { dot: 'bg-primary border-primary',          bar: 'bg-primary/20',      text: 'text-primary' },
  warning: { dot: 'bg-warning border-warning',          bar: 'bg-warning/30',      text: 'text-warning' },
  error:   { dot: 'bg-destructive border-destructive',  bar: 'bg-destructive/20',  text: 'text-destructive' },
};

// ── TraceTimeline ──────────────────────────────────────────────────────────────

function TraceTimeline({ trace, dtmf }: { trace: TraceEntry[]; dtmf: DtmfEntry[] }) {
  return (
    <div className="px-4 py-3">
      {trace.length === 0
        ? <p className="text-xs text-muted-foreground italic">No trace data.</p>
        : (
          <ol>
            {trace.map((t, i) => {
              const s = TRACE_STYLE[t.level] ?? TRACE_STYLE['info']!;
              return (
                <li key={i} className="flex gap-3 pb-3 last:pb-0">
                  <div className="flex flex-col items-center">
                    <div className={cn('h-2.5 w-2.5 rounded-full border-2 mt-0.5 shrink-0', s.dot)} />
                    {i < trace.length - 1 && <div className={cn('w-0.5 flex-1 mt-1', s.bar)} />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className={cn('text-xs font-semibold', s.text)}>{t.title}</span>
                      <span className="text-[10px] font-mono text-muted-foreground">
                        {new Date(t.at).toLocaleTimeString()} · {t.step}
                      </span>
                    </div>
                    {t.detail && <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">{t.detail}</p>}
                  </div>
                </li>
              );
            })}
          </ol>
        )
      }
      {dtmf.length > 0 && (
        <div className="mt-3 pt-3 border-t border-border/40">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">DTMF pressed</p>
          <div className="flex gap-1.5 flex-wrap">
            {dtmf.map((d, i) => (
              <span key={i} title={`at ${new Date(d.receivedAt).toLocaleTimeString()}`}
                className="inline-flex h-6 w-6 items-center justify-center rounded border border-border bg-secondary font-mono text-xs font-bold">
                {d.digit}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── CampaignCallLogs tab ───────────────────────────────────────────────────────

function CampaignCallLogs({ token }: { token: () => string }) {
  const [logs, setLogs]           = useState<CallLogRecord[]>([]);
  const [total, setTotal]         = useState(0);
  const [pages, setPages]         = useState(1);
  const [page, setPage]           = useState(1);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [expanded, setExpanded]   = useState<Record<string, boolean>>({});
  const [connected, setConnected] = useState(false);
  const [liveCount, setLiveCount] = useState(0);
  const [phoneFilter, setPhoneFilter] = useState('');
  const [dispFilter, setDispFilter]   = useState('all');
  const socketRef = useRef<Socket | null>(null);

  const load = useCallback(async (p = 1) => {
    setLoading(true); setError('');
    try {
      const qs = new URLSearchParams({ page: String(p), limit: '50' });
      if (phoneFilter) qs.set('phone', phoneFilter);
      if (dispFilter !== 'all') qs.set('disposition', dispFilter);
      const r = await fetch(`/api/call-logs?${qs}`, { headers: { Authorization: `Bearer ${token()}` } });
      const d = await r.json() as { data: CallLogRecord[]; total: number; error?: string };
      if (d.error) { setError(d.error); return; }
      setLogs(d.data ?? []);
      setTotal(d.total ?? 0);
      setPages(Math.max(1, Math.ceil((d.total ?? 0) / 50)));
      setPage(p);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [phoneFilter, dispFilter, token]);

  useEffect(() => { void load(1); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'https' : 'http';
    const port     = process.env['NEXT_PUBLIC_GATEWAY_PORT'] ?? '3001';
    const s: Socket = io(`${protocol}://${window.location.hostname}:${port}`, {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: Infinity,
    });
    socketRef.current = s;
    s.on('connect',    () => setConnected(true));
    s.on('disconnect', () => setConnected(false));
    s.on('call:started', () => setLiveCount((c) => c + 1));
    s.on('call:ended',   () => { setLiveCount((c) => Math.max(0, c - 1)); void load(1); });
    s.on('call:failed',  () => { setLiveCount((c) => Math.max(0, c - 1)); void load(1); });
    return () => { s.disconnect(); };
  }, [load]);

  const toggle = (id: string) => setExpanded((p) => ({ ...p, [id]: !p[id] }));

  return (
    <div className="space-y-4">
      {/* Live banner */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border">
          {connected
            ? <><Wifi className="h-3 w-3 text-success" /><span className="text-success">Live</span></>
            : <><WifiOff className="h-3 w-3 text-muted-foreground" /><span className="text-muted-foreground">Offline</span></>}
        </div>
        {liveCount > 0 && (
          <span className="text-xs text-primary animate-pulse">
            ● {liveCount} call{liveCount !== 1 ? 's' : ''} active
          </span>
        )}
        <div className="ml-auto">
          <Button size="sm" variant="secondary" onClick={() => void load(page)} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap items-end">
        <div className="space-y-1">
          <Label className="text-xs">Phone</Label>
          <Input placeholder="+1..." className="text-xs w-40" value={phoneFilter}
            onChange={(e) => setPhoneFilter(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Disposition</Label>
          <Select value={dispFilter} onValueChange={setDispFilter}>
            <SelectTrigger className="text-xs w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              {['all','answered','machine','no_answer','busy','failed','cancelled'].map((v) => (
                <SelectItem key={v} value={v}>{v === 'all' ? 'All' : v.replace('_',' ')}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button size="sm" onClick={() => void load(1)} disabled={loading}>
          <Filter className="h-3.5 w-3.5 mr-1" /> Filter
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardContent className="pt-0 px-0">
          {loading ? (
            <div className="flex justify-center py-16 gap-2 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : logs.length === 0 ? (
            <div className="flex flex-col items-center py-16 gap-3">
              <PhoneOff className="h-10 w-10 text-muted-foreground/20" />
              <p className="text-sm text-muted-foreground">No campaign call logs yet. Start a campaign to see detailed logs here.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-5" />
                  <TableHead>Phone</TableHead>
                  <TableHead>Disposition</TableHead>
                  <TableHead>AMD</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Agent</TableHead>
                  <TableHead>Attempt</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead>Channel</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.flatMap((log) => {
                  const isOpen = expanded[log._id];
                  return [
                    <TableRow key={log._id} className="cursor-pointer hover:bg-secondary/50"
                      onClick={() => toggle(log._id)}>
                      <TableCell className="pr-0">
                        {isOpen
                          ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                          : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                      </TableCell>
                      <TableCell>
                        <p className="font-mono text-xs font-medium">{log.phone || '—'}</p>
                        {log.contactName && <p className="text-[10px] text-muted-foreground">{log.contactName}</p>}
                      </TableCell>
                      <TableCell>
                        <span className={cn('text-xs font-semibold capitalize', LOG_DISP[log.disposition] ?? 'text-muted-foreground')}>
                          {log.disposition.replace(/_/g, ' ')}
                        </span>
                        {log.failureReason && (
                          <p className="text-[10px] text-destructive/80 max-w-48 truncate" title={log.failureReason}>
                            {log.failureReason}
                          </p>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className={cn('text-xs font-mono',
                          log.amdResult === 'HUMAN' ? 'text-success' :
                          log.amdResult === 'MACHINE' ? 'text-warning' : 'text-muted-foreground')}>
                          {log.amdResult ?? '—'}
                        </span>
                      </TableCell>
                      <TableCell className="font-mono text-xs tabular-nums">
                        {log.duration != null ? fmtSec(log.duration) : '—'}
                      </TableCell>
                      <TableCell className="text-xs">
                        {log.routedAgent ? `${log.routedAgent.name} (${log.routedAgent.extension})` : '—'}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">#{log.attempt}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{fmtDateShort(log.startTime)}</TableCell>
                      <TableCell>
                        <span className="text-[10px] font-mono text-muted-foreground/70 truncate max-w-32 block"
                          title={log.channelId}>{log.channelId || log.uniqueId || '—'}</span>
                      </TableCell>
                    </TableRow>,
                    ...(isOpen ? [
                      <TableRow key={`${log._id}-detail`} className="hover:bg-transparent">
                        <TableCell colSpan={9} className="p-0 bg-secondary/20 border-b border-border/40">
                          <div className="px-4 py-2 border-b border-border/30 flex flex-wrap gap-x-6 gap-y-1 text-[10px] font-mono text-muted-foreground">
                            <span><strong>Channel:</strong> {log.channelId || '—'}</span>
                            <span><strong>UniqueID:</strong> {log.uniqueId || '—'}</span>
                            <span><strong>Start:</strong> {new Date(log.startTime).toLocaleString()}</span>
                            {log.answerTime && <span><strong>Answered:</strong> {new Date(log.answerTime).toLocaleString()}</span>}
                            {log.endTime   && <span><strong>Ended:</strong>   {new Date(log.endTime).toLocaleString()}</span>}
                            {log.failureStage && <span className="text-destructive"><strong>Failed at:</strong> {log.failureStage}</span>}
                          </div>
                          <TraceTimeline trace={log.trace} dtmf={log.dtmfSequence} />
                        </TableCell>
                      </TableRow>,
                    ] : []),
                  ];
                })}
              </TableBody>
            </Table>
          )}
          {pages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-border/50">
              <p className="text-xs text-muted-foreground">{total} records · Page {page} of {pages}</p>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" disabled={page <= 1 || loading} onClick={() => void load(page - 1)}>
                  <ArrowLeft className="h-3.5 w-3.5" />
                </Button>
                <Button size="sm" variant="secondary" disabled={page >= pages || loading} onClick={() => void load(page + 1)}>
                  <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function CdrPage() {
  const { accessToken } = useAuth();
  const token = useCallback(() => accessToken ?? localStorage.getItem('dialer_access_token') ?? '', [accessToken]);
  const h = useCallback(() => ({ Authorization: `Bearer ${token()}` }), [token]);
  const [tab, setTab] = useState<'campaign' | 'asterisk'>('campaign');

  const [records, setRecords]   = useState<CdrRecord[]>([]);
  const [stats, setStats]       = useState<StatBucket[]>([]);
  const [total, setTotal]       = useState(0);
  const [pages, setPages]       = useState(1);
  const [page, setPage]         = useState(1);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');

  // Filters
  const [from, setFrom]           = useState('');
  const [to, setTo]               = useState('');
  const [typeFilter, setTypeFilter]     = useState('all');
  const [dispFilter, setDispFilter]     = useState('all');
  const [srcFilter, setSrcFilter]       = useState('');
  const [dstFilter, setDstFilter]       = useState('');

  const load = useCallback(async (p = page) => {
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams({ page: String(p), limit: '50' });
      if (from)       params.set('from', new Date(from).toISOString());
      if (to)         params.set('to',   new Date(to).toISOString());
      if (typeFilter && typeFilter !== 'all') params.set('type', typeFilter);
      if (dispFilter && dispFilter !== 'all') params.set('disposition', dispFilter);
      if (srcFilter)  params.set('src', srcFilter);
      if (dstFilter)  params.set('dst', dstFilter);

      const r  = await fetch(`/api/cdr?${params}`, { headers: h() });
      const d  = await r.json() as { records: CdrRecord[]; total: number; pages: number; stats: StatBucket[]; error?: string };
      if (d.error) { setError(d.error); return; }
      setRecords(d.records ?? []);
      setStats(d.stats ?? []);
      setTotal(d.total ?? 0);
      setPages(d.pages ?? 1);
      setPage(p);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [page, from, to, typeFilter, dispFilter, srcFilter, dstFilter, h]);

  useEffect(() => { void load(1); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const applyFilters = () => void load(1);

  // Stat helpers
  const totalCalls    = stats.reduce((a, s) => a + s.count, 0);
  const answeredStats = stats.find(s => s._id === 'ANSWERED');
  const answerRate    = totalCalls ? Math.round(((answeredStats?.count ?? 0) / totalCalls) * 100) : 0;
  const totalTalkTime = stats.reduce((a, s) => a + (s.totalSecs ?? 0), 0);

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Call Logs</h1>
          <p className="text-sm text-muted-foreground mt-1">Detailed campaign call traces + Asterisk CDR</p>
        </div>
      </div>

      {/* Tab switcher */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="campaign">Campaign Logs</TabsTrigger>
          <TabsTrigger value="asterisk">Asterisk CDR</TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === 'campaign' && <CampaignCallLogs token={token} />}

      {tab === 'asterisk' && (<div className="space-y-6">

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">{error}</div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Total Calls',   value: total.toLocaleString(),               icon: <Phone className="h-4 w-4" /> },
          { label: 'Answered',      value: (answeredStats?.count ?? 0).toLocaleString(), icon: <PhoneIncoming className="h-4 w-4 text-success" /> },
          { label: 'Answer Rate',   value: `${answerRate}%`,                     icon: <PhoneOutgoing className="h-4 w-4 text-primary" /> },
          { label: 'Total Talk',    value: fmtSec(totalTalkTime),                icon: <Phone className="h-4 w-4 text-warning" /> },
        ].map(({ label, value, icon }) => (
          <Card key={label}>
            <CardContent className="pt-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-muted">{icon}</div>
              <div><p className="text-xs text-muted-foreground">{label}</p><p className="text-xl font-bold">{value}</p></div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center gap-2 mb-3">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <p className="text-sm font-medium">Filters</p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 items-end">
            <div className="space-y-1">
              <Label className="text-xs">From</Label>
              <Input type="datetime-local" value={from} onChange={e => setFrom(e.target.value)} className="text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">To</Label>
              <Input type="datetime-local" value={to} onChange={e => setTo(e.target.value)} className="text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Type</Label>
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="text-xs"><SelectValue placeholder="All types" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  <SelectItem value="internal">Internal</SelectItem>
                  <SelectItem value="inbound">Inbound</SelectItem>
                  <SelectItem value="outbound">Outbound</SelectItem>
                  <SelectItem value="campaign">Campaign</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Disposition</Label>
              <Select value={dispFilter} onValueChange={setDispFilter}>
                <SelectTrigger className="text-xs"><SelectValue placeholder="All" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="ANSWERED">Answered</SelectItem>
                  <SelectItem value="NO ANSWER">No Answer</SelectItem>
                  <SelectItem value="BUSY">Busy</SelectItem>
                  <SelectItem value="FAILED">Failed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">From Number</Label>
              <Input placeholder="1001" value={srcFilter} onChange={e => setSrcFilter(e.target.value)} className="text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">To Number</Label>
              <Input placeholder="1002" value={dstFilter} onChange={e => setDstFilter(e.target.value)} className="text-xs" />
            </div>
          </div>
          <Button size="sm" className="mt-3" onClick={applyFilters} disabled={loading}>
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Filter className="h-3.5 w-3.5 mr-1" />}
            Apply Filters
          </Button>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="pt-0 px-0">
          {loading ? (
            <div className="flex justify-center items-center py-16 gap-2 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading CDR records…
            </div>
          ) : records.length === 0 ? (
            <div className="flex flex-col items-center py-16 gap-3">
              <PhoneOff className="h-10 w-10 text-muted-foreground/20" />
              <p className="text-sm text-muted-foreground">No CDR records found. Make a call to see it here.</p>
              <p className="text-xs text-muted-foreground/70">Internal calls appear here once the AMI CDR listener is running.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>From</TableHead>
                  <TableHead>To</TableHead>
                  <TableHead>Context</TableHead>
                  <TableHead>Start</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Talk Time</TableHead>
                  <TableHead>Disposition</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.map(r => (
                  <TableRow key={r._id}>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        {TYPE_ICONS[r.type] ?? <Phone className="h-3.5 w-3.5" />}
                        <span className="text-xs capitalize text-muted-foreground">{r.type}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-xs">
                        <p className="font-mono font-medium">{r.src || '—'}</p>
                        {r.callerIdName && r.callerIdName !== r.src && (
                          <p className="text-muted-foreground">{r.callerIdName}</p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{r.dst || '—'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground font-mono">{r.dstContext}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{fmtDateShort(r.startTime)}</TableCell>
                    <TableCell className="font-mono text-xs tabular-nums">{fmtSec(r.duration)}</TableCell>
                    <TableCell className="font-mono text-xs tabular-nums">
                      {r.billableSeconds > 0 ? fmtSec(r.billableSeconds) : '—'}
                    </TableCell>
                    <TableCell>
                      <span className={cn('text-xs font-medium', DISP_COLORS[r.disposition] ?? 'text-muted-foreground')}>
                        {r.disposition}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {/* Pagination */}
          {pages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-border/50">
              <p className="text-xs text-muted-foreground">{total} records · Page {page} of {pages}</p>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" disabled={page <= 1 || loading} onClick={() => void load(page - 1)}>
                  <ArrowLeft className="h-3.5 w-3.5" />
                </Button>
                <Button size="sm" variant="secondary" disabled={page >= pages || loading} onClick={() => void load(page + 1)}>
                  <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      </div>)}

    </div>
  );
}
