'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { GitBranch, Plus, UploadCloud } from 'lucide-react';

interface IvrFlow {
  _id: string; name: string; campaignId: string;
  steps: Array<{ id: string; type: string }>;
  isDeployed: boolean; deployedAt?: string; createdAt: string;
}
interface Campaign { _id: string; name: string; }

const TYPE_ICONS: Record<string, string> = { play: '▶', dtmf_collect: '🔢', route_agent: '👤', webhook: '🔗', hangup: '⊗', start: '◎' };

export default function IvrBuilderListPage() {
  const [flows, setFlows] = useState<IvrFlow[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);

  const token = () => localStorage.getItem('dialer_access_token') ?? '';

  useEffect(() => {
    Promise.all([
      fetch('/api/ivr-flows', { headers: { Authorization: `Bearer ${token()}` } }).then((r) => r.json() as Promise<{ data: IvrFlow[] }>),
      fetch('/api/campaigns', { headers: { Authorization: `Bearer ${token()}` } }).then((r) => r.json() as Promise<{ data: Campaign[] }>),
    ]).then(([f, c]) => { setFlows(f.data ?? []); setCampaigns(c.data ?? []); })
     .catch(console.error)
     .finally(() => setLoading(false));
  }, []);

  const campaignName = (id: string) => campaigns.find((c) => c._id === id)?.name ?? '—';

  const handleDeploy = async (id: string) => {
    const r = await fetch(`/api/ivr-flows/${id}/deploy`, { method: 'POST', headers: { Authorization: `Bearer ${token()}` } });
    if (r.ok) setFlows((p) => p.map((f) => f._id === id ? { ...f, isDeployed: true, deployedAt: new Date().toISOString() } : f));
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">IVR Builder</h1>
          <p className="text-sm text-muted-foreground mt-1">Design and deploy interactive voice response flows</p>
        </div>
        <Link href="/dashboard/ivr-builder/new">
          <Button><Plus className="h-4 w-4" /> New Flow</Button>
        </Link>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24 text-muted-foreground text-sm">Loading flows...</div>
      ) : flows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-20 gap-4">
            <div className="rounded-full bg-secondary p-4">
              <GitBranch className="h-8 w-8 text-muted-foreground" />
            </div>
            <div className="text-center">
              <p className="font-medium text-foreground">No IVR flows yet</p>
              <p className="text-sm text-muted-foreground mt-1">Create one to automate your call handling.</p>
            </div>
            <Link href="/dashboard/ivr-builder/new">
              <Button><Plus className="h-4 w-4" /> Create your first flow</Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {flows.map((flow) => (
            <Card key={flow._id} className="hover:border-primary/30 transition-colors">
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2.5 mb-1.5">
                      <span className="font-semibold text-foreground">{flow.name}</span>
                      <Badge variant={flow.isDeployed ? 'running' : 'draft'}>{flow.isDeployed ? 'Deployed' : 'Draft'}</Badge>
                    </div>
                    <div className="flex gap-4 text-xs text-muted-foreground">
                      <span>Campaign: <strong className="text-foreground">{campaignName(flow.campaignId)}</strong></span>
                      <span>{flow.steps.length} steps</span>
                      <span>Created {new Date(flow.createdAt).toLocaleDateString()}</span>
                      {flow.deployedAt && <span>Deployed {new Date(flow.deployedAt).toLocaleDateString()}</span>}
                    </div>
                    <div className="flex flex-wrap gap-1.5 mt-2.5">
                      {flow.steps.map((s) => (
                        <span key={s.id} className="inline-flex items-center gap-1 rounded border border-border bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground">
                          {TYPE_ICONS[s.type] ?? '?'} {s.type}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    {!flow.isDeployed && (
                      <Button size="sm" variant="success" onClick={() => void handleDeploy(flow._id)}>
                        <UploadCloud className="h-3.5 w-3.5" /> Deploy
                      </Button>
                    )}
                    <Link href={`/dashboard/ivr-builder/${flow._id}`}>
                      <Button size="sm" variant="secondary">Edit →</Button>
                    </Link>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
