'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, CheckCircle2, Phone, PowerOff, Users, QrCode } from 'lucide-react';

interface Agent {
  _id: string; name: string; extension: string; sipEndpoint: string;
  status: 'available' | 'busy' | 'offline' | 'break';
  maxConcurrentCalls: number; updatedAt: string;
}

interface AgentCredentials {
  email: string;
  loginPassword: string;
  extension: string;
  sipPassword: string;
}

const STATUS_STYLE: Record<string, { dot: string; text: string }> = {
  available: { dot: 'bg-success', text: 'text-success' },
  busy:      { dot: 'bg-primary', text: 'text-primary' },
  offline:   { dot: 'bg-muted-foreground', text: 'text-muted-foreground' },
  break:     { dot: 'bg-warning', text: 'text-warning' },
};

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', extension: '', maxConcurrentCalls: 1, password: '' });
  const [saving, setSaving] = useState(false);
  const [credentials, setCredentials] = useState<AgentCredentials | null>(null);
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);

  const token = () => localStorage.getItem('dialer_access_token') ?? '';

  const fetchAgents = () => {
    fetch('/api/agents', { headers: { Authorization: `Bearer ${token()}` } })
      .then((r) => r.json() as Promise<{ data: Agent[] }>)
      .then((d) => setAgents(d.data ?? []))
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchAgents(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    try {
      const res = await fetch('/api/agents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form }),
      });
      const data = await res.json() as { error?: string; credentials?: AgentCredentials };
      if (!res.ok) throw new Error(data.error ?? 'Failed to create agent');
      if (data.credentials) setCredentials(data.credentials);
      setShowForm(false);
      setForm({ name: '', email: '', extension: '', maxConcurrentCalls: 1, password: '' });
      fetchAgents();
    } catch (err) {
      alert((err as Error).message);
    } finally { setSaving(false); }
  };

  const setStatus = async (id: string, status: string) => {
    await fetch(`/api/agents/${id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    setAgents((p) => p.map((a) => a._id === id ? { ...a, status: status as Agent['status'] } : a));
  };

  const issueQrLogin = async (id: string) => {
    setQrError(null);
    try {
      const res = await fetch(`/api/agents/${id}/qr-login`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token()}` },
      });
      const data = await res.json() as { error?: string; data?: { loginUrl: string } };
      if (!res.ok || !data.data?.loginUrl) throw new Error(data.error ?? 'Could not generate QR login');
      const image = await QRCode.toDataURL(data.data.loginUrl);
      setQrImage(image);
    } catch (err) {
      setQrError((err as Error).message);
      setQrImage(null);
    }
  };

  const counts = { available: agents.filter((a) => a.status === 'available').length, busy: agents.filter((a) => a.status === 'busy').length, offline: agents.filter((a) => a.status === 'offline').length };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Agents</h1>
          <p className="text-sm text-muted-foreground mt-1">SIP agent pool management</p>
        </div>
        <Button onClick={() => setShowForm(!showForm)}>
          <Plus className="h-4 w-4" /> Add Agent
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[{ label: 'Available', count: counts.available, color: 'text-success', icon: CheckCircle2 },
          { label: 'On Call', count: counts.busy, color: 'text-primary', icon: Phone },
          { label: 'Offline', count: counts.offline, color: 'text-muted-foreground', icon: PowerOff }].map((s) => {
          const Icon = s.icon;
          return (
            <Card key={s.label}><CardContent className="pt-6">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">{s.label}</p>
                  <p className={`text-3xl font-bold mt-1 ${s.color}`}>{s.count}</p>
                </div>
                <div className={`${s.color} rounded-lg bg-secondary p-2`}><Icon className="h-4 w-4" /></div>
              </div>
            </CardContent></Card>
          );
        })}
      </div>

      {showForm && (
        <Card>
          <CardHeader><CardTitle className="text-base">New Agent</CardTitle></CardHeader>
          <Separator />
          <CardContent className="pt-4">
            <form onSubmit={(e) => void handleCreate(e)} className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Name</Label>
                <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input required type="email" placeholder="agent@example.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Extension (optional)</Label>
                <Input className="font-mono" placeholder="Auto if empty (e.g. 1001)" value={form.extension} onChange={(e) => setForm({ ...form, extension: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Max Concurrent Calls</Label>
                <Input type="number" min={1} max={10} value={form.maxConcurrentCalls} onChange={(e) => setForm({ ...form, maxConcurrentCalls: Number(e.target.value) })} />
              </div>
              <div className="space-y-1.5">
                <Label>Agent Login Password (optional)</Label>
                <Input type="text" placeholder="Auto-generate if empty" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              </div>
              <div className="col-span-2 flex gap-2">
                <Button type="submit" disabled={saving}>{saving ? 'Creating...' : 'Create Agent'}</Button>
                <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-0 px-0">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">Loading agents...</div>
          ) : agents.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Users className="h-10 w-10 text-muted-foreground/40" />
              <p className="text-muted-foreground text-sm">No agents configured yet</p>
              <Button variant="outline" size="sm" onClick={() => setShowForm(true)}>Add your first agent</Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead><TableHead>Extension</TableHead><TableHead>SIP Endpoint</TableHead>
                  <TableHead>Status</TableHead><TableHead>Max Calls</TableHead><TableHead>Updated</TableHead><TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {agents.map((a) => {
                  const s = STATUS_STYLE[a.status] ?? STATUS_STYLE['offline']!;
                  return (
                    <TableRow key={a._id}>
                      <TableCell className="font-medium">{a.name}</TableCell>
                      <TableCell className="font-mono text-xs">{a.extension}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{a.sipEndpoint}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className={`h-2 w-2 rounded-full ${s.dot}`} />
                          <span className={`text-xs capitalize ${s.text}`}>{a.status}</span>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{a.maxConcurrentCalls}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{new Date(a.updatedAt).toLocaleString()}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {a.status !== 'available' && <Button size="sm" variant="success" onClick={() => void setStatus(a._id, 'available')}>Available</Button>}
                          {a.status !== 'offline' && <Button size="sm" variant="secondary" onClick={() => void setStatus(a._id, 'offline')}>Offline</Button>}
                          <Button size="sm" variant="outline" onClick={() => void issueQrLogin(a._id)}>
                            <QrCode className="h-3.5 w-3.5 mr-1" /> QR Login
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {(credentials || qrImage || qrError) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Agent Access</CardTitle>
          </CardHeader>
          <Separator />
          <CardContent className="pt-4 space-y-3">
            {credentials && (
              <div className="text-sm space-y-1">
                <p><span className="font-medium">Email:</span> {credentials.email}</p>
                <p><span className="font-medium">Login Password:</span> <span className="font-mono">{credentials.loginPassword}</span></p>
                <p><span className="font-medium">Extension:</span> <span className="font-mono">{credentials.extension}</span></p>
                <p><span className="font-medium">SIP Password:</span> <span className="font-mono">{credentials.sipPassword}</span></p>
              </div>
            )}
            {qrError && <p className="text-sm text-destructive">{qrError}</p>}
            {qrImage && (
              <div className="inline-flex flex-col gap-2 items-start">
                <p className="text-sm text-muted-foreground">Scan this QR code to login as the selected agent:</p>
                <img src={qrImage} alt="Agent QR login code" className="h-auto w-full max-w-44 rounded border bg-white p-2" />
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
