'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { BarChart3, Phone, CheckCircle2, Clock, Layers } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ReportData {
  timeSeries: Array<{ _id: string; total: number; dispositions: Array<{ disposition: string; count: number }> }>;
  summary: Array<{ _id: string; count: number; avgDuration: number }>;
  amdBreakdown: Array<{ _id: string; count: number }>;
  queueMetrics: { waiting: number; active: number; failed: number; completed: number };
}

const DISP_COLORS: Record<string, string> = {
  answered: 'bg-success', machine: 'bg-warning', busy: 'bg-primary',
  no_answer: 'bg-muted-foreground', failed: 'bg-destructive', cancelled: 'bg-muted-foreground',
};
const DISP_TEXT: Record<string, string> = {
  answered: 'text-success', machine: 'text-warning', busy: 'text-primary',
  no_answer: 'text-muted-foreground', failed: 'text-destructive', cancelled: 'text-muted-foreground',
};

export default function ReportsPage() {
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [granularity, setGranularity] = useState<'hour' | 'day' | 'week'>('day');

  const token = () => localStorage.getItem('access_token') ?? '';

  useEffect(() => {
    setLoading(true);
    fetch(`/api/reports?granularity=${granularity}`, { headers: { Authorization: `Bearer ${token()}` } })
      .then((r) => r.json() as Promise<ReportData>)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [granularity]);

  const totalCalls = (data?.summary ?? []).reduce((s, x) => s + x.count, 0) ?? 0;
  const answeredCount = (data?.summary ?? []).find((x) => x._id === 'answered')?.count ?? 0;
  const answerRate = totalCalls > 0 ? ((answeredCount / totalCalls) * 100).toFixed(1) : '0.0';
  const avgDuration = (data?.summary ?? []).find((x) => x._id === 'answered')?.avgDuration ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Reports</h1>
          <p className="text-sm text-muted-foreground mt-1">Call performance analytics</p>
        </div>
        <Tabs value={granularity} onValueChange={(v) => setGranularity(v as typeof granularity)}>
          <TabsList>
            <TabsTrigger value="hour">Hour</TabsTrigger>
            <TabsTrigger value="day">Day</TabsTrigger>
            <TabsTrigger value="week">Week</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24 text-muted-foreground text-sm">Loading report data...</div>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {[
              { label: 'Total Calls', value: totalCalls.toLocaleString(), icon: Phone, color: 'text-primary' },
              { label: 'Answer Rate', value: `${answerRate}%`, icon: CheckCircle2, color: 'text-success' },
              { label: 'Avg Handle Time', value: avgDuration > 0 ? `${Math.floor(avgDuration/60)}m ${Math.round(avgDuration%60)}s` : '—', icon: Clock, color: 'text-primary' },
              { label: 'Queued', value: String(data?.queueMetrics?.waiting ?? 0), icon: Layers, color: 'text-warning' },
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
            {/* Disposition breakdown */}
            <Card>
              <CardHeader><CardTitle className="text-base">Disposition Breakdown</CardTitle></CardHeader>
              <Separator />
              <CardContent className="pt-4 space-y-3">
                {(data?.summary ?? []).length === 0 ? (
                  <p className="text-center text-muted-foreground py-8 text-sm">No data</p>
                ) : (
                  (data?.summary ?? []).sort((a, b) => b.count - a.count).map((row) => (
                    <div key={row._id}>
                      <div className="flex justify-between text-sm mb-1.5">
                        <span className={cn('capitalize', DISP_TEXT[row._id] ?? 'text-foreground')}>{row._id?.replace(/_/g, ' ')}</span>
                        <span className="font-mono text-xs text-muted-foreground">{row.count} ({totalCalls > 0 ? ((row.count / totalCalls) * 100).toFixed(1) : 0}%)</span>
                      </div>
                      <Progress value={totalCalls > 0 ? (row.count / totalCalls) * 100 : 0}
                        indicatorClassName={DISP_COLORS[row._id] ?? 'bg-primary'} />
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            {/* Queue health */}
            <Card>
              <CardHeader><CardTitle className="text-base">Queue Health</CardTitle></CardHeader>
              <Separator />
              <CardContent className="pt-4">
                <div className="grid grid-cols-2 gap-4">
                  {[
                    { label: 'Waiting',   value: data?.queueMetrics?.waiting   ?? 0, color: 'text-primary' },
                    { label: 'Active',    value: data?.queueMetrics?.active     ?? 0, color: 'text-success' },
                    { label: 'Failed',    value: data?.queueMetrics?.failed     ?? 0, color: 'text-destructive' },
                    { label: 'Completed', value: data?.queueMetrics?.completed  ?? 0, color: 'text-muted-foreground' },
                  ].map((q) => (
                    <div key={q.label} className="rounded-lg bg-secondary p-4 text-center">
                      <div className={`text-2xl font-bold font-mono ${q.color}`}>{q.value.toLocaleString()}</div>
                      <div className="text-xs text-muted-foreground mt-1 uppercase tracking-wide">{q.label}</div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Time series */}
          {(data?.timeSeries ?? []).length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Call Volume Over Time</CardTitle></CardHeader>
              <Separator />
              <CardContent className="pt-0 px-0">
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Period</TableHead><TableHead>Total</TableHead><TableHead>Answered</TableHead><TableHead>Machines</TableHead><TableHead>Failed</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {[...(data?.timeSeries ?? [])].reverse().map((row) => {
                      const get = (d: string) => row.dispositions.find((x) => x.disposition === d)?.count ?? 0;
                      return (
                        <TableRow key={row._id}>
                          <TableCell className="font-mono text-xs">{row._id}</TableCell>
                          <TableCell className="font-mono text-xs">{row.total}</TableCell>
                          <TableCell className="font-mono text-xs text-success">{get('answered')}</TableCell>
                          <TableCell className="font-mono text-xs text-warning">{get('machine')}</TableCell>
                          <TableCell className="font-mono text-xs text-destructive">{get('failed')}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
