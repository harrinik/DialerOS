'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Plus, RefreshCw, Loader2, Layers, Pause, Play, UserMinus, UserPlus } from 'lucide-react';

interface Queue { name: string; strategy?: string; calls?: number; max?: number }
const STRATEGIES = ['ringall', 'leastrecent', 'fewestcalls', 'random', 'rrmemory', 'linear', 'wrandom'];

export default function QueuesPage() {
  const [queues, setQueues] = useState<Queue[]>([]);
  const [raw, setRaw] = useState('');
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [strategy, setStrategy] = useState('rrmemory');
  const [members, setMembers] = useState('');
  const [creating, setCreating] = useState(false);
  const [actionQueue, setActionQueue] = useState('');
  const [addExt, setAddExt] = useState('');
  const [error, setError] = useState('');

  const token = () => localStorage.getItem('dialer_access_token') ?? '';
  const h = () => ({ Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' });

  const load = () => {
    setLoading(true);
    fetch('/api/asterisk/queues', { headers: h() }).then(r => r.json())
      .then((d: { data: Queue[]; raw?: string; error?: string }) => {
        if (d.error) setError(d.error); else { setQueues(d.data ?? []); setRaw(d.raw ?? ''); }
      }).finally(() => setLoading(false));
  };
  useEffect(load, []);

  const create = async () => {
    setCreating(true); setError('');
    const memberList = members.split(',').map(s => s.trim()).filter(Boolean);
    const r = await fetch('/api/asterisk/queues', { method: 'POST', headers: h(), body: JSON.stringify({ name, strategy, members: memberList }) });
    const d = await r.json() as { ok: boolean; error?: string };
    setCreating(false);
    if (d.ok) { setShowCreate(false); setName(''); setMembers(''); load(); }
    else setError(d.error ?? 'Failed');
  };

  const queueAction = async (queueName: string, action: string, extension?: string) => {
    await fetch(`/api/asterisk/queues/${encodeURIComponent(queueName)}`, {
      method: 'POST', headers: h(),
      body: JSON.stringify({ action, ...(extension ? { extension } : {}) }),
    });
    load();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold">Call Queues</h1>
          <p className="text-sm text-muted-foreground mt-1">ACD queues for agent distribution — managed via AMI</p></div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={load}><RefreshCw className="h-4 w-4" /></Button>
          <Button size="sm" onClick={() => setShowCreate(!showCreate)}><Plus className="h-4 w-4" /> New Queue</Button>
        </div>
      </div>

      {error && <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>}

      {showCreate && (
        <Card>
          <CardContent className="pt-4 space-y-4">
            <p className="font-semibold text-sm">Create Queue</p>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <div className="space-y-1.5"><Label>Queue Name</Label><Input placeholder="sales" value={name} onChange={e => setName(e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Strategy</Label>
                <Select value={strategy} onValueChange={setStrategy}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{STRATEGIES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Initial Members (extensions, comma-separated)</Label>
                <Input placeholder="1001, 1002, 1003" value={members} onChange={e => setMembers(e.target.value)} />
              </div>
            </div>
            <div className="flex gap-3">
              <Button onClick={create} disabled={creating || !name}>
                {creating ? <><Loader2 className="h-4 w-4 animate-spin" /> Creating…</> : 'Create Queue'}
              </Button>
              <Button variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Queue list */}
      <Card>
        <CardContent className="pt-0 px-0">
          {loading ? <div className="py-16 text-center text-sm text-muted-foreground">Loading queues from Asterisk…</div>
            : queues.length === 0 ? (
              <div className="flex flex-col items-center py-16 gap-3">
                <Layers className="h-10 w-10 text-muted-foreground/20" />
                <p className="text-sm text-muted-foreground">No queues found. Create one above.</p>
              </div>
            ) : (
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Queue</TableHead><TableHead>Strategy</TableHead>
                  <TableHead>Active Calls</TableHead><TableHead>Max</TableHead>
                  <TableHead>Member Actions</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {queues.map(q => (
                    <TableRow key={q.name}>
                      <TableCell className="font-mono font-medium">{q.name}</TableCell>
                      <TableCell><Badge variant="secondary">{q.strategy ?? '—'}</Badge></TableCell>
                      <TableCell className="tabular-nums">{q.calls ?? 0}</TableCell>
                      <TableCell className="tabular-nums text-muted-foreground">{q.max ?? '∞'}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Input className="w-24 h-7 text-xs" placeholder="ext…"
                            value={actionQueue === q.name ? addExt : ''}
                            onChange={e => { setActionQueue(q.name); setAddExt(e.target.value); }} />
                          <Button size="sm" variant="secondary" title="Add member"
                            onClick={() => void queueAction(q.name, 'add_member', addExt)}>
                            <UserPlus className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="sm" variant="secondary" title="Remove member"
                            onClick={() => void queueAction(q.name, 'remove_member', addExt)}>
                            <UserMinus className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="sm" variant="ghost" title="Pause member"
                            onClick={() => void queueAction(q.name, 'pause', addExt)}>
                            <Pause className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="sm" variant="ghost" title="Unpause member"
                            onClick={() => void queueAction(q.name, 'unpause', addExt)}>
                            <Play className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
        </CardContent>
      </Card>

      {raw && (
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs font-medium text-muted-foreground mb-2">Raw AMI Output</p>
            <pre className="text-xs font-mono bg-secondary rounded-lg p-4 overflow-x-auto max-h-60 whitespace-pre">{raw}</pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
