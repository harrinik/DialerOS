'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ShieldOff, Plus, Search, CheckCircle2, XCircle } from 'lucide-react';

interface DncEntry { _id: string; phone: string; reason?: string; source: string; addedAt: string; }

export default function DncPage() {
  const [entries, setEntries] = useState<DncEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [phone, setPhone] = useState('');
  const [reason, setReason] = useState('');
  const [adding, setAdding] = useState(false);
  const [checkPhone, setCheckPhone] = useState('');
  const [checkResult, setCheckResult] = useState<null | { isBlocked: boolean }>(null);

  const token = () => localStorage.getItem('access_token') ?? '';

  const fetchDnc = () => {
    fetch('/api/dnc', { headers: { Authorization: `Bearer ${token()}` } })
      .then((r) => r.json() as Promise<{ data: DncEntry[] }>)
      .then((d) => setEntries(d.data ?? []))
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchDnc(); }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault(); setAdding(true);
    try {
      await fetch('/api/dnc', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, reason, source: 'manual' }),
      });
      setPhone(''); setReason('');
      fetchDnc();
    } finally { setAdding(false); }
  };

  const handleCheck = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await fetch(`/api/dnc/check?phone=${encodeURIComponent(checkPhone)}`, { headers: { Authorization: `Bearer ${token()}` } });
    setCheckResult(await r.json() as { isBlocked: boolean });
  };

  const handleRemove = async (id: string) => {
    await fetch(`/api/dnc/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token()}` } });
    setEntries((p) => p.filter((e) => e._id !== id));
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">DNC List</h1>
        <p className="text-sm text-muted-foreground mt-1">{entries.length.toLocaleString()} numbers on Do-Not-Call list</p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Plus className="h-4 w-4" />Add Number</CardTitle></CardHeader>
          <Separator />
          <CardContent className="pt-4 space-y-3">
            <form onSubmit={(e) => void handleAdd(e)} className="space-y-3">
              <div className="space-y-1.5">
                <Label>Phone (E.164)</Label>
                <Input required className="font-mono" placeholder="+15551234567" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Reason (optional)</Label>
                <Input placeholder="Customer request" value={reason} onChange={(e) => setReason(e.target.value)} />
              </div>
              <Button type="submit" disabled={adding}><ShieldOff className="h-4 w-4" />{adding ? 'Adding...' : 'Add to DNC'}</Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Search className="h-4 w-4" />Check Number</CardTitle></CardHeader>
          <Separator />
          <CardContent className="pt-4 space-y-3">
            <form onSubmit={(e) => void handleCheck(e)} className="space-y-3">
              <div className="space-y-1.5">
                <Label>Phone to check</Label>
                <Input required className="font-mono" placeholder="+15551234567" value={checkPhone}
                  onChange={(e) => { setCheckPhone(e.target.value); setCheckResult(null); }} />
              </div>
              <Button type="submit" variant="secondary">Check DNC</Button>
            </form>
            {checkResult !== null && (
              <div className={`flex items-center gap-3 rounded-lg border p-3 mt-2 ${checkResult.isBlocked ? 'border-destructive/30 bg-destructive/10' : 'border-success/30 bg-success/10'}`}>
                {checkResult.isBlocked
                  ? <><XCircle className="h-4 w-4 text-destructive shrink-0" /><span className="text-sm text-destructive font-medium">Blocked — number is on DNC list</span></>
                  : <><CheckCircle2 className="h-4 w-4 text-success shrink-0" /><span className="text-sm text-success font-medium">Clear — not on DNC list</span></>
                }
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="pt-0 px-0">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">Loading...</div>
          ) : entries.length === 0 ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">No numbers on the DNC list</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow><TableHead>Phone</TableHead><TableHead>Reason</TableHead><TableHead>Source</TableHead><TableHead>Added</TableHead><TableHead>Action</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((e) => (
                  <TableRow key={e._id}>
                    <TableCell className="font-mono text-xs">{e.phone}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{e.reason ?? '—'}</TableCell>
                    <TableCell><Badge variant="secondary">{e.source}</Badge></TableCell>
                    <TableCell className="text-xs text-muted-foreground">{new Date(e.addedAt).toLocaleString()}</TableCell>
                    <TableCell>
                      <Button size="sm" variant="destructive" onClick={() => void handleRemove(e._id)}>Remove</Button>
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
