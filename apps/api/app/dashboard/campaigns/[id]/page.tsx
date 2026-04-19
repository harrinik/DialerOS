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
import { Phone, CheckCircle2, Play, Pause, ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Campaign {
  _id: string; name: string; status: string; callerIdName: string; callerIdNumber: string;
  sipTrunk: string; concurrency: number; amdAction: string; maxRetries: number;
  stats: { total: number; pending: number; answered: number; machines: number; failed: number; noAnswer: number; busy: number };
  ivrFlowId?: { _id: string; name: string; isDeployed: boolean };
  createdAt: string; updatedAt: string;
}
interface CallLog {
  _id: string; phone: string; disposition: string; duration?: number; amdResult?: string; startTime: string;
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

export default function CampaignDetailPage() {
  const id = (useParams()['id'] as string);
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [recentCalls, setRecentCalls] = useState<CallLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionPending, setActionPending] = useState(false);

  const token = () => localStorage.getItem('dialer_access_token') ?? '';

  const fetchCampaign = async () => {
    const r = await fetch(`/api/campaigns/${id}`, { headers: { Authorization: `Bearer ${token()}` } });
    const d = await r.json() as { data: Campaign };
    setCampaign(d.data);
  };

  useEffect(() => {
    Promise.all([
      fetchCampaign(),
      fetch(`/api/call-logs?campaignId=${id}&limit=20`, { headers: { Authorization: `Bearer ${token()}` } })
        .then((r) => r.json() as Promise<{ data: CallLog[] }>)
        .then((d) => setRecentCalls(d.data ?? [])),
    ]).finally(() => setLoading(false));
  }, [id]);

  const handleToggle = async () => {
    if (!campaign) return;
    setActionPending(true);
    const action = campaign.status === 'running' ? 'pause' : 'start';
    try {
      await fetch(`/api/campaigns/${id}/${action}`, { method: 'POST', headers: { Authorization: `Bearer ${token()}` } });
      await fetchCampaign();
    } finally { setActionPending(false); }
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
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
        {campaign.status !== 'completed' && campaign.status !== 'archived' && (
          <Button disabled={actionPending} variant={campaign.status === 'running' ? 'secondary' : 'default'}
            onClick={() => void handleToggle()}>
            {campaign.status === 'running'
              ? <><Pause className="h-4 w-4" /> Pause</>
              : <><Play className="h-4 w-4 fill-current" /> Start</>
            }
          </Button>
        )}
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
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
          <CardContent className="pt-4">
            <table className="w-full text-sm">
              <tbody>
                {[
                  ['Concurrency', `${campaign.concurrency}× simultaneous`],
                  ['AMD Action', campaign.amdAction],
                  ['Max Retries', String(campaign.maxRetries)],
                  ['IVR Flow', campaign.ivrFlowId?.name ?? 'Direct route'],
                  ['Caller ID', `${campaign.callerIdName} <${campaign.callerIdNumber}>`],
                  ['SIP Trunk', campaign.sipTrunk],
                ].map(([k, v]) => (
                  <tr key={k} className="border-b border-border/50">
                    <td className="py-2.5 text-xs text-muted-foreground w-40">{k}</td>
                    <td className="py-2.5 text-xs font-mono text-foreground">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>

      {/* Recent calls */}
      <Card>
        <CardHeader><CardTitle className="text-base">Recent Calls</CardTitle></CardHeader>
        <Separator />
        <CardContent className="pt-0 px-0">
          {recentCalls.length === 0 ? (
            <p className="text-center text-muted-foreground py-10 text-sm">No calls recorded yet</p>
          ) : (
            <Table>
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
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
