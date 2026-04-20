'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Separator } from '@/components/ui/separator';
import { Phone, Search, Play, Pause, Plus } from 'lucide-react';

interface Campaign {
  _id: string; name: string; status: string; callerIdName: string;
  callerIdNumber: string; sipTrunk: string; concurrency: number;
  stats: { total: number; pending: number; answered: number; machines: number; failed: number };
  updatedAt: string;
}

const STATUS_BADGE: Record<string, BadgeProps['variant']> = {
  running: 'running', paused: 'paused', draft: 'draft', completed: 'completed', archived: 'secondary',
};

const STATUSES = ['running', 'paused', 'draft', 'completed', 'archived'];

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ status: '', q: '' });

  const token = () => localStorage.getItem('dialer_access_token') ?? '';

  const fetchCampaigns = () => {
    const params = new URLSearchParams();
    if (filter.status) params.set('status', filter.status);
    fetch(`/api/campaigns?${params}`, { headers: { Authorization: `Bearer ${token()}` } })
      .then((r) => r.json() as Promise<{ data: Campaign[] }>)
      .then((d) => setCampaigns(d.data ?? []))
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchCampaigns(); }, [filter.status]);

  const toggleStatus = async (id: string, current: string) => {
    const action = current === 'running' ? 'pause' : 'start';
    await fetch(`/api/campaigns/${id}/${action}`, {
      method: 'POST', headers: { Authorization: `Bearer ${token()}` },
    });
    fetchCampaigns();
  };

  const visible = campaigns.filter((c) =>
    !filter.q || c.name.toLowerCase().includes(filter.q.toLowerCase()) ||
    c.callerIdNumber.includes(filter.q),
  );

  const answerRate = (c: Campaign) =>
    c.stats.total > 0 ? ((c.stats.answered / c.stats.total) * 100).toFixed(0) : '0';

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Campaigns</h1>
          <p className="text-sm text-muted-foreground mt-1">{campaigns.length} total campaigns</p>
        </div>
        <Link href="/dashboard/campaigns/new">
          <Button><Plus className="h-4 w-4" /> New Campaign</Button>
        </Link>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <div className="relative w-full flex-1 sm:min-w-48">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="pl-8" placeholder="Search name or caller ID..." value={filter.q}
                onChange={(e) => setFilter({ ...filter, q: e.target.value })} />
            </div>
            <div className="w-full sm:w-auto sm:min-w-40">
              <Select value={filter.status} onValueChange={(v) => setFilter({ ...filter, status: v === 'all' ? '' : v })}>
                <SelectTrigger><SelectValue placeholder="All statuses" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  {STATUSES.map((s) => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="pt-0 px-0">
          {loading ? (
            <div className="flex items-center justify-center py-20 text-muted-foreground text-sm">Loading campaigns...</div>
          ) : visible.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <Phone className="h-10 w-10 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">No campaigns found</p>
            </div>
          ) : (
            <Table className="min-w-245">
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Caller ID</TableHead>
                  <TableHead>Contacts</TableHead>
                  <TableHead>Answered</TableHead>
                  <TableHead>Rate</TableHead>
                  <TableHead>Concurrency</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((c) => (
                  <TableRow key={c._id}>
                    <TableCell>
                      <Link href={`/dashboard/campaigns/${c._id}`}
                        className="font-medium hover:text-primary transition-colors">
                        {c.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_BADGE[c.status] ?? 'secondary'}>{c.status}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground font-mono">
                      <span className="block">{c.callerIdName}</span>
                      <span>{c.callerIdNumber}</span>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{c.stats.total.toLocaleString()}</TableCell>
                    <TableCell className="font-mono text-xs text-success">{c.stats.answered.toLocaleString()}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-16 rounded-full bg-secondary overflow-hidden">
                          <div className="h-full rounded-full bg-success" style={{ width: `${answerRate(c)}%` }} />
                        </div>
                        <span className="font-mono text-xs text-muted-foreground">{answerRate(c)}%</span>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{c.concurrency}×</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{new Date(c.updatedAt).toLocaleDateString()}</TableCell>
                    <TableCell>
                      <div className="flex gap-1.5">
                        {c.status === 'running' ? (
                          <Button size="sm" variant="secondary" onClick={() => void toggleStatus(c._id, c.status)}>
                            <Pause className="h-3.5 w-3.5" /> Pause
                          </Button>
                        ) : c.status !== 'completed' && c.status !== 'archived' ? (
                          <Button size="sm" onClick={() => void toggleStatus(c._id, c.status)}>
                            <Play className="h-3.5 w-3.5 fill-current" /> Start
                          </Button>
                        ) : null}
                        <Link href={`/dashboard/campaigns/${c._id}`}>
                          <Button size="sm" variant="outline">View</Button>
                        </Link>
                      </div>
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
