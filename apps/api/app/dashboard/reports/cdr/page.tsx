'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { RefreshCw, Loader2, Phone, PhoneOff, PhoneIncoming, PhoneOutgoing, ArrowLeft, ArrowRight, Filter } from 'lucide-react';
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

// ── Page ───────────────────────────────────────────────────────────────────────

export default function CdrPage() {
  const { accessToken } = useAuth();
  const h = useCallback(() => ({ Authorization: `Bearer ${accessToken ?? ''}` }), [accessToken]);

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
          <h1 className="text-2xl font-bold tracking-tight">Call Detail Records</h1>
          <p className="text-sm text-muted-foreground mt-1">All calls — internal, inbound, outbound, and campaigns</p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => void load(page)} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </Button>
      </div>

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
    </div>
  );
}
