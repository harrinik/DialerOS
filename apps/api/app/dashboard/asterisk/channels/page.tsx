'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { PhoneOff, Eye, Headphones, RefreshCw, Plus, Trash2, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Channel {
  id: string; name: string; state: string;
  caller: { name: string; number: string };
  connected: { name: string; number: string };
  dialplan: { context: string; exten: string };
  creationtime: string;
}

const STATE_COLORS: Record<string, string> = { Up: 'text-success', Ring: 'text-warning', Ringing: 'text-warning', Down: 'text-muted-foreground', Dialing: 'text-primary' };

function elapsed(t: string) {
  const s = Math.floor((Date.now() - new Date(t).getTime()) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export default function ChannelsPage() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [spyExt, setSpyExt] = useState('');
  const [spyMode, setSpyMode] = useState('q');
  const [actionPending, setActionPending] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const token = () => localStorage.getItem('dialer_access_token') ?? '';
  const h = () => ({ Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' });

  const load = useCallback(() => {
    fetch('/api/asterisk/channels', { headers: h() }).then(r => r.json())
      .then((d: { data: Channel[]; error?: string }) => {
        if (d.error) setError(d.error); else { setChannels(d.data ?? []); setError(''); }
      }).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); const i = setInterval(load, 3000); return () => clearInterval(i); }, [load]);
  useEffect(() => { const i = setInterval(() => setTick(n => n + 1), 1000); return () => clearInterval(i); }, []);

  const hangup = async (channelId: string) => {
    setActionPending(channelId);
    await fetch(`/api/asterisk/channels/${encodeURIComponent(channelId)}/hangup`, { method: 'POST', headers: h(), body: JSON.stringify({}) });
    setActionPending(null); load();
  };

  const spy = async (channelId: string) => {
    if (!spyExt) return;
    setActionPending(`spy-${channelId}`);
    await fetch(`/api/asterisk/channels/${encodeURIComponent(channelId)}/hangup`, { method: 'POST', headers: h(), body: JSON.stringify({ spyExtension: spyExt, spyMode }) });
    setActionPending(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Live Channels</h1>
          <p className="text-sm text-muted-foreground mt-1">{channels.length} active channel{channels.length !== 1 ? 's' : ''} · auto-refreshes every 3s</p>
        </div>
        <Button variant="secondary" size="sm" onClick={load}><RefreshCw className="h-4 w-4" /></Button>
      </div>

      {error && <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>}

      {/* Spy config */}
      <Card>
        <CardContent className="pt-4">
          <p className="text-sm font-medium mb-3">Supervisor Spy / Barge-in</p>
          <div className="flex gap-3 flex-wrap">
            <div className="space-y-1.5">
              <Label className="text-xs">Your Extension</Label>
              <Input className="w-32" placeholder="9000" value={spyExt} onChange={e => setSpyExt(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Mode</Label>
              <Select value={spyMode} onValueChange={setSpyMode}>
                <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="q">Listen only</SelectItem>
                  <SelectItem value="w">Whisper to agent</SelectItem>
                  <SelectItem value="B">Barge (both hear)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end"><p className="text-xs text-muted-foreground pb-2">Click 👁 on any call row to activate spy on that channel.</p></div>
          </div>
        </CardContent>
      </Card>

      {/* Channel table */}
      <Card>
        <CardContent className="pt-0 px-0">
          {loading ? <div className="py-16 text-center text-sm text-muted-foreground">Connecting to Asterisk…</div>
            : channels.length === 0 ? (
              <div className="flex flex-col items-center py-16 gap-3">
                <PhoneOff className="h-10 w-10 text-muted-foreground/20" />
                <p className="text-sm text-muted-foreground">No active channels. Calls will appear here in real-time.</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Channel</TableHead><TableHead>State</TableHead>
                    <TableHead>Caller</TableHead><TableHead>Connected To</TableHead>
                    <TableHead>Context / Exten</TableHead><TableHead>Duration</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {channels.map(ch => (
                    <TableRow key={ch.id}>
                      <TableCell className="font-mono text-xs">{ch.name}</TableCell>
                      <TableCell>
                        <span className={cn('text-xs font-medium', STATE_COLORS[ch.state] ?? 'text-muted-foreground')}>
                          ● {ch.state}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs">
                        <span className="block font-medium">{ch.caller?.name || '—'}</span>
                        <span className="text-muted-foreground font-mono">{ch.caller?.number || '—'}</span>
                      </TableCell>
                      <TableCell className="text-xs">
                        <span className="block font-medium">{ch.connected?.name || '—'}</span>
                        <span className="text-muted-foreground font-mono">{ch.connected?.number || '—'}</span>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground font-mono">
                        {ch.dialplan?.context} / {ch.dialplan?.exten}
                      </TableCell>
                      <TableCell className="font-mono text-xs tabular-nums">{elapsed(ch.creationtime)}</TableCell>
                      <TableCell>
                        <div className="flex gap-1.5">
                          <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" title="Hangup"
                            disabled={actionPending === ch.id} onClick={() => void hangup(ch.id)}>
                            {actionPending === ch.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PhoneOff className="h-3.5 w-3.5" />}
                          </Button>
                          <Button size="sm" variant="ghost" title="Spy" disabled={!spyExt || actionPending === `spy-${ch.id}`}
                            onClick={() => void spy(ch.id)}>
                            {actionPending === `spy-${ch.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Headphones className="h-3.5 w-3.5" />}
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
    </div>
  );
}
