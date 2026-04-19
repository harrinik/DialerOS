'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Separator } from '@/components/ui/separator';
import { Plus, Trash2, RefreshCw, Loader2, CheckCircle2, XCircle, Phone } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Endpoint { id: string; state: string; channel_ids: string[] }
interface FormState {
  extension: string; displayName: string; password: string;
  transport: string; codecs: string[]; maxContacts: string; dtmfMode: string; directMedia: boolean;
}
const CODEC_OPTIONS = ['ulaw', 'alaw', 'g722', 'g729', 'opus', 'gsm'];
const TRANSPORT_OPTIONS = ['transport-udp', 'transport-tcp', 'transport-tls', 'transport-wss'];
const DEFAULT_FORM: FormState = { extension: '', displayName: '', password: '', transport: 'transport-udp', codecs: ['ulaw', 'alaw'], maxContacts: '1', dtmfMode: 'rfc4733', directMedia: false };

export default function EndpointsPage() {
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [error, setError] = useState('');

  const token = () => localStorage.getItem('access_token') ?? '';
  const h = () => ({ Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' });

  const load = () => {
    setLoading(true);
    fetch('/api/asterisk/endpoints', { headers: h() }).then(r => r.json())
      .then((d: { data: Endpoint[]; error?: string }) => {
        if (d.error) setError(d.error); else setEndpoints(d.data ?? []);
      }).finally(() => setLoading(false));
  };

  useEffect(load, []);

  const toggleCodec = (c: string) => setForm(p => ({
    ...p, codecs: p.codecs.includes(c) ? p.codecs.filter(x => x !== c) : [...p.codecs, c]
  }));

  const create = async () => {
    setCreating(true); setError('');
    const r = await fetch('/api/asterisk/endpoints', { method: 'POST', headers: h(), body: JSON.stringify({ ...form, maxContacts: parseInt(form.maxContacts) }) });
    const d = await r.json() as { ok: boolean; error?: string };
    setCreating(false);
    if (d.ok) { setShowForm(false); setForm(DEFAULT_FORM); load(); }
    else setError(d.error ?? 'Failed to create endpoint');
  };

  const remove = async (id: string) => {
    if (!confirm(`Delete extension ${id}?`)) return;
    await fetch(`/api/asterisk/endpoints/${encodeURIComponent(id)}`, { method: 'DELETE', headers: h() });
    load();
  };

  const stateColor = (s: string) => s === 'online' ? 'text-success' : s === 'unavailable' ? 'text-destructive' : 'text-muted-foreground';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold">PJSIP Endpoints</h1><p className="text-sm text-muted-foreground mt-1">{endpoints.length} extensions configured in Asterisk</p></div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={load}><RefreshCw className="h-4 w-4" /></Button>
          <Button size="sm" onClick={() => setShowForm(!showForm)}><Plus className="h-4 w-4" /> New Extension</Button>
        </div>
      </div>

      {error && <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>}

      {/* Create form */}
      {showForm && (
        <Card>
          <CardContent className="pt-4 space-y-4">
            <p className="font-semibold text-sm">Create SIP Extension</p>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <div className="space-y-1.5"><Label>Extension Number</Label><Input placeholder="1001" value={form.extension} onChange={e => setForm(p => ({ ...p, extension: e.target.value }))} /></div>
              <div className="space-y-1.5"><Label>Display Name</Label><Input placeholder="John Smith" value={form.displayName} onChange={e => setForm(p => ({ ...p, displayName: e.target.value }))} /></div>
              <div className="space-y-1.5"><Label>SIP Password</Label><Input type="password" placeholder="Auto-generate or set" value={form.password} onChange={e => setForm(p => ({ ...p, password: e.target.value }))} /></div>
              <div className="space-y-1.5"><Label>Transport</Label>
                <Select value={form.transport} onValueChange={v => setForm(p => ({ ...p, transport: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{TRANSPORT_OPTIONS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5"><Label>DTMF Mode</Label>
                <Select value={form.dtmfMode} onValueChange={v => setForm(p => ({ ...p, dtmfMode: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="rfc4733">RFC 4733 (Recommended)</SelectItem>
                    <SelectItem value="inband">In-band</SelectItem>
                    <SelectItem value="info">SIP INFO</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5"><Label>Max Devices</Label>
                <Select value={form.maxContacts} onValueChange={v => setForm(p => ({ ...p, maxContacts: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{['1','2','3','5','10'].map(n => <SelectItem key={n} value={n}>{n} device{n !== '1' ? 's' : ''}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Codecs (select all to allow)</Label>
              <div className="flex gap-2 flex-wrap">
                {CODEC_OPTIONS.map(c => (
                  <button key={c} onClick={() => toggleCodec(c)} className={cn('px-3 py-1 rounded-full text-xs font-mono border transition-colors', form.codecs.includes(c) ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:border-primary/50')}>
                    {c}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-3">
              <Button onClick={create} disabled={creating || !form.extension || !form.password}>
                {creating ? <><Loader2 className="h-4 w-4 animate-spin" /> Creating…</> : 'Create Extension'}
              </Button>
              <Button variant="ghost" onClick={() => { setShowForm(false); setForm(DEFAULT_FORM); }}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Table */}
      <Card>
        <CardContent className="pt-0 px-0">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">Loading endpoints from Asterisk…</div>
          ) : endpoints.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Phone className="h-10 w-10 text-muted-foreground/20" />
              <p className="text-sm text-muted-foreground">No PJSIP endpoints found. Create one or check your Asterisk connection.</p>
            </div>
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>Extension</TableHead><TableHead>State</TableHead>
                <TableHead>Active Channels</TableHead><TableHead>Actions</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {endpoints.map(ep => (
                  <TableRow key={ep.id}>
                    <TableCell className="font-mono font-medium">{ep.id}</TableCell>
                    <TableCell>
                      <span className={cn('text-xs capitalize font-medium', stateColor(ep.state))}>
                        {ep.state === 'online' ? '● ' : ep.state === 'unavailable' ? '● ' : '○ '}{ep.state ?? 'unknown'}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground font-mono">{ep.channel_ids?.length ?? 0}</TableCell>
                    <TableCell>
                      <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => void remove(ep.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className="border-border/50">
        <CardContent className="pt-4 text-xs text-muted-foreground space-y-1">
          <p className="font-medium text-foreground text-sm">SIP Client Configuration</p>
          <p>Server: <code className="font-mono bg-secondary px-1 rounded">your-asterisk-ip</code> · Port: <code className="font-mono bg-secondary px-1 rounded">5060 (UDP/TCP)</code> or <code className="font-mono bg-secondary px-1 rounded">5061 (TLS)</code></p>
          <p>Each extension registers with its number as the Username and the password you set. Context: <code className="font-mono bg-secondary px-1 rounded">agents</code></p>
        </CardContent>
      </Card>
    </div>
  );
}
