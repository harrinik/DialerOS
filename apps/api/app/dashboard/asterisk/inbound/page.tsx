'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2, Send, RefreshCw, DownloadCloud, Loader2 } from 'lucide-react';

interface Route { _id: string; did: string; description: string; destination: string; destinationId?: string; destinationName?: string; isActive: boolean }
interface IvrFlow { _id: string; name: string }

const DEST_TYPES = ['ivr_flow', 'queue', 'extension', 'voicemail', 'hangup'];

export default function InboundRoutesPage() {
  const [routes, setRoutes] = useState<Route[]>([]);
  const [ivrFlows, setIvrFlows] = useState<IvrFlow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [form, setForm] = useState({ did: '', description: '', destination: 'ivr_flow', destinationId: '', priority: '1' });
  const [dialplan, setDialplan] = useState('');
  const [error, setError] = useState('');

  const token = () => localStorage.getItem('dialer_access_token') ?? '';
  const h = () => ({ Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' });

  const load = () => {
    setLoading(true);
    Promise.all([
      fetch('/api/asterisk/inbound', { headers: h() }).then(r => r.json()) as Promise<{ data: Route[] }>,
      fetch('/api/ivr-flows', { headers: h() }).then(r => r.json()) as Promise<{ data: IvrFlow[] }>,
    ]).then(([ir, ivr]) => { setRoutes(ir.data ?? []); setIvrFlows(ivr.data ?? []); }).finally(() => setLoading(false));
  };
  useEffect(load, []);

  const create = async () => {
    const r = await fetch('/api/asterisk/inbound', { method: 'POST', headers: h(), body: JSON.stringify({ ...form, priority: parseInt(form.priority) }) });
    const d = await r.json() as { data?: Route; error?: string };
    if (d.error) setError(d.error);
    else { setShowForm(false); setForm({ did: '', description: '', destination: 'ivr_flow', destinationId: '', priority: '1' }); load(); }
  };

  const remove = async (id: string) => {
    await fetch(`/api/asterisk/inbound/${id}`, { method: 'DELETE', headers: h() });
    load();
  };

  const pushDialplan = async () => {
    setPushing(true);
    const r = await fetch('/api/asterisk/inbound', { method: 'PUT', headers: h(), body: JSON.stringify({ action: 'push_dialplan' }) });
    const d = await r.json() as { ok: boolean; dialplan?: string; error?: string };
    setPushing(false);
    if (d.dialplan) setDialplan(d.dialplan);
    if (!d.ok) setError(d.error ?? 'Push failed');
  };

  const destinationLabel = (r: Route) => {
    if (r.destination === 'ivr_flow') return `IVR: ${r.destinationName ?? r.destinationId ?? '—'}`;
    if (r.destination === 'queue') return `Queue: ${r.destinationId ?? '—'}`;
    if (r.destination === 'extension') return `Extension: ${r.destinationId ?? '—'}`;
    if (r.destination === 'voicemail') return `Voicemail: ${r.destinationId ?? '—'}`;
    return r.destination;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold">Inbound Routes</h1><p className="text-sm text-muted-foreground mt-1">Map incoming DIDs to IVR flows, queues, or extensions</p></div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={load}><RefreshCw className="h-4 w-4" /></Button>
          <Button variant="secondary" size="sm" onClick={() => void pushDialplan()} disabled={pushing}>
            {pushing ? <><Loader2 className="h-4 w-4 animate-spin" /> Pushing…</> : <><Send className="h-4 w-4" /> Push to Asterisk</>}
          </Button>
          <Button size="sm" onClick={() => setShowForm(!showForm)}><Plus className="h-4 w-4" /> Add DID</Button>
        </div>
      </div>

      {error && <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>}

      {showForm && (
        <Card>
          <CardContent className="pt-4 space-y-4">
            <p className="font-semibold text-sm">Add Inbound Route</p>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <div className="space-y-1.5"><Label>DID / Phone Number</Label><Input placeholder="+15125551234 or _X." value={form.did} onChange={e => setForm(p => ({ ...p, did: e.target.value }))} /></div>
              <div className="space-y-1.5"><Label>Description</Label><Input placeholder="Main line" value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} /></div>
              <div className="space-y-1.5"><Label>Destination Type</Label>
                <Select value={form.destination} onValueChange={v => setForm(p => ({ ...p, destination: v, destinationId: '' }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{DEST_TYPES.map(t => <SelectItem key={t} value={t}>{t.replace('_', ' ')}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {form.destination === 'ivr_flow' && (
                <div className="space-y-1.5"><Label>IVR Flow</Label>
                  <Select value={form.destinationId} onValueChange={v => setForm(p => ({ ...p, destinationId: v }))}>
                    <SelectTrigger><SelectValue placeholder="Select flow…" /></SelectTrigger>
                    <SelectContent>{ivrFlows.map(f => <SelectItem key={f._id} value={f._id}>{f.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              )}
              {(form.destination === 'queue' || form.destination === 'extension' || form.destination === 'voicemail') && (
                <div className="space-y-1.5"><Label>Destination ID</Label><Input placeholder="Queue name or extension" value={form.destinationId} onChange={e => setForm(p => ({ ...p, destinationId: e.target.value }))} /></div>
              )}
            </div>
            <div className="flex gap-3">
              <Button onClick={create} disabled={!form.did}>Add Route</Button>
              <Button variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-0 px-0">
          {loading ? <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div> : (
            <Table>
              <TableHeader><TableRow><TableHead>DID</TableHead><TableHead>Description</TableHead><TableHead>Destination</TableHead><TableHead>Status</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader>
              <TableBody>
                {routes.map(r => (
                  <TableRow key={r._id}>
                    <TableCell className="font-mono font-medium">{r.did}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{r.description}</TableCell>
                    <TableCell className="text-sm">{destinationLabel(r)}</TableCell>
                    <TableCell><Badge variant={r.isActive ? 'running' : 'secondary'}>{r.isActive ? 'Active' : 'Inactive'}</Badge></TableCell>
                    <TableCell>
                      <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => void remove(r._id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </TableCell>
                  </TableRow>
                ))}
                {routes.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-10 text-sm">No inbound routes configured.</TableCell></TableRow>}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {dialplan && (
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between mb-2"><p className="text-sm font-medium">Generated Dialplan</p><Badge variant="secondary">extensions_dialer.conf</Badge></div>
            <pre className="text-xs font-mono bg-secondary rounded-lg p-4 overflow-x-auto whitespace-pre">{dialplan}</pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
