'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2, RefreshCw, Loader2, Link2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Trunk { id: string; state: string }
interface TrunkForm {
  name: string; host: string; port: string; username: string; password: string;
  fromUser: string; fromDomain: string; transport: string; codecs: string[];
  context: string; maxChannels: string; type: string; outboundProxy: string;
}
const CODEC_OPTIONS = ['ulaw', 'alaw', 'g722', 'g729'];
const DEFAULT_FORM: TrunkForm = { name: '', host: '', port: '5060', username: '', password: '', fromUser: '', fromDomain: '', transport: 'transport-udp', codecs: ['ulaw', 'alaw'], context: 'from-trunk', maxChannels: '30', type: 'registration', outboundProxy: '' };

export default function TrunksPage() {
  const [trunks, setTrunks] = useState<Trunk[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<TrunkForm>(DEFAULT_FORM);
  const [creating, setCreating] = useState(false);
  const [qualifying, setQualifying] = useState<string | null>(null);
  const [error, setError] = useState('');

  const token = () => localStorage.getItem('dialer_access_token') ?? '';
  const h = () => ({ Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' });

  const load = () => {
    setLoading(true);
    fetch('/api/asterisk/trunks', { headers: h() }).then(r => r.json())
      .then((d: { data: Trunk[]; error?: string }) => { setTrunks(d.data ?? []); if (d.error) setError(d.error); })
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const toggleCodec = (c: string) => setForm(p => ({ ...p, codecs: p.codecs.includes(c) ? p.codecs.filter(x => x !== c) : [...p.codecs, c] }));

  const create = async () => {
    setCreating(true); setError('');
    const r = await fetch('/api/asterisk/trunks', { method: 'POST', headers: h(), body: JSON.stringify({ ...form, port: parseInt(form.port), maxChannels: parseInt(form.maxChannels) }) });
    const d = await r.json() as { ok: boolean; error?: string };
    setCreating(false);
    if (d.ok) { setShowForm(false); setForm(DEFAULT_FORM); load(); }
    else setError(d.error ?? 'Failed');
  };

  const qualify = async (id: string) => {
    setQualifying(id);
    await fetch(`/api/asterisk/trunks/${encodeURIComponent(id)}`, { method: 'POST', headers: h(), body: JSON.stringify({ action: 'qualify' }) });
    setQualifying(null);
    setTimeout(load, 2000);
  };

  const remove = async (id: string) => {
    if (!confirm(`Delete trunk ${id}?`)) return;
    await fetch(`/api/asterisk/trunks/${encodeURIComponent(id)}`, { method: 'DELETE', headers: h() });
    load();
  };

  const stateColor = (s: string) => s === 'online' ? 'running' : s === 'unavailable' ? 'destructive' : 'secondary';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold">SIP Trunks</h1><p className="text-sm text-muted-foreground mt-1">{trunks.length} trunks · outbound+inbound routes to your SIP provider</p></div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={load}><RefreshCw className="h-4 w-4" /></Button>
          <Button size="sm" onClick={() => setShowForm(!showForm)}><Plus className="h-4 w-4" /> Add Trunk</Button>
        </div>
      </div>

      {error && <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>}

      {showForm && (
        <Card>
          <CardContent className="pt-4 space-y-4">
            <p className="font-semibold text-sm">New SIP Trunk</p>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <div className="space-y-1.5"><Label>Trunk Name</Label><Input placeholder="voip_provider" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} /></div>
              <div className="space-y-1.5"><Label>Provider Host / IP</Label><Input placeholder="sip.provider.com" value={form.host} onChange={e => setForm(p => ({ ...p, host: e.target.value }))} /></div>
              <div className="space-y-1.5"><Label>Port</Label><Input value={form.port} onChange={e => setForm(p => ({ ...p, port: e.target.value }))} /></div>
              <div className="space-y-1.5"><Label>Auth Type</Label>
                <Select value={form.type} onValueChange={v => setForm(p => ({ ...p, type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="registration">Registration-based (outbound reg)</SelectItem>
                    <SelectItem value="ip_auth">IP-based (no registration)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5"><Label>Username</Label><Input placeholder="SIP username / DID" value={form.username} onChange={e => setForm(p => ({ ...p, username: e.target.value }))} /></div>
              <div className="space-y-1.5"><Label>Password</Label><Input type="password" value={form.password} onChange={e => setForm(p => ({ ...p, password: e.target.value }))} /></div>
              <div className="space-y-1.5"><Label>From User</Label><Input placeholder="CallerID number" value={form.fromUser} onChange={e => setForm(p => ({ ...p, fromUser: e.target.value }))} /></div>
              <div className="space-y-1.5"><Label>From Domain</Label><Input placeholder="provider.com" value={form.fromDomain} onChange={e => setForm(p => ({ ...p, fromDomain: e.target.value }))} /></div>
              <div className="space-y-1.5"><Label>Transport</Label>
                <Select value={form.transport} onValueChange={v => setForm(p => ({ ...p, transport: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="transport-udp">UDP (default)</SelectItem>
                    <SelectItem value="transport-tcp">TCP</SelectItem>
                    <SelectItem value="transport-tls">TLS</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5"><Label>Inbound Context</Label><Input value={form.context} onChange={e => setForm(p => ({ ...p, context: e.target.value }))} /></div>
              <div className="space-y-1.5"><Label>Max Channels</Label><Input type="number" value={form.maxChannels} onChange={e => setForm(p => ({ ...p, maxChannels: e.target.value }))} /></div>
              <div className="space-y-1.5"><Label>Outbound Proxy (optional)</Label><Input placeholder="proxy.provider.com:5060" value={form.outboundProxy} onChange={e => setForm(p => ({ ...p, outboundProxy: e.target.value }))} /></div>
            </div>
            <div className="space-y-1.5">
              <Label>Allowed Codecs</Label>
              <div className="flex gap-2 flex-wrap">
                {CODEC_OPTIONS.map(c => (
                  <button key={c} onClick={() => toggleCodec(c)} className={cn('px-3 py-1 rounded-full text-xs font-mono border transition-colors', form.codecs.includes(c) ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:border-primary/50')}>{c}</button>
                ))}
              </div>
            </div>
            <div className="flex gap-3">
              <Button onClick={create} disabled={creating || !form.name || !form.host}>{creating ? <><Loader2 className="h-4 w-4 animate-spin" /> Creating…</> : 'Create Trunk'}</Button>
              <Button variant="ghost" onClick={() => { setShowForm(false); setForm(DEFAULT_FORM); }}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-0 px-0">
          {loading ? <div className="py-16 text-center text-sm text-muted-foreground">Loading trunks…</div>
            : trunks.length === 0 ? (
              <div className="flex flex-col items-center py-16 gap-3">
                <Link2 className="h-10 w-10 text-muted-foreground/20" />
                <p className="text-sm text-muted-foreground">No SIP trunks found. Add your first trunk to enable outbound calling.</p>
              </div>
            ) : (
              <Table>
                <TableHeader><TableRow><TableHead>Trunk ID</TableHead><TableHead>State</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader>
                <TableBody>
                  {trunks.map(t => (
                    <TableRow key={t.id}>
                      <TableCell className="font-mono font-medium">{t.id}</TableCell>
                      <TableCell><Badge variant={stateColor(t.state) as 'running' | 'secondary' | 'destructive'}>{t.state ?? 'unknown'}</Badge></TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <Button size="sm" variant="secondary" disabled={qualifying === t.id} onClick={() => void qualify(t.id)}>
                            {qualifying === t.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Qualify'}
                          </Button>
                          <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => void remove(t.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
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
