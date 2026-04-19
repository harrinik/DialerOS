'use client';

import { useEffect, useRef, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Play, Pause, Download, Mic } from 'lucide-react';

interface Recording {
  filename: string; sizeBytes: number; modifiedAt: string;
  callLogId?: string; callerId?: string;
}

function fmtSize(b: number) { return b > 1_000_000 ? `${(b / 1_000_000).toFixed(1)} MB` : `${(b / 1000).toFixed(0)} KB`; }

export default function RecordingsPage() {
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [directory, setDirectory] = useState('');
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [playing, setPlaying] = useState<string | null>(null);
  const [error, setError] = useState('');
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const token = () => localStorage.getItem('access_token') ?? '';
  const h = () => ({ Authorization: `Bearer ${token()}` });

  const load = () => {
    setLoading(true);
    fetch('/api/asterisk/recordings', { headers: h() }).then(r => r.json())
      .then((d: { data?: Recording[]; directory?: string; error?: string }) => {
        if (d.error) setError(d.error);
        else { setRecordings(d.data ?? []); setDirectory(d.directory ?? ''); }
      }).finally(() => setLoading(false));
  };
  useEffect(load, []);

  const togglePlay = (filename: string) => {
    if (playing === filename) { audioRef.current?.pause(); setPlaying(null); return; }
    if (audioRef.current) audioRef.current.pause();
    const audio = new Audio(`/api/asterisk/recordings/${encodeURIComponent(filename)}/stream`);
    audioRef.current = audio;
    audio.play().catch(e => setError(String(e)));
    audio.onended = () => setPlaying(null);
    setPlaying(filename);
  };

  const download = (filename: string) => {
    const a = document.createElement('a');
    a.href = `/api/asterisk/recordings/${encodeURIComponent(filename)}/stream`;
    a.download = filename;
    a.click();
  };

  const visible = recordings.filter(r => !filter || r.filename.toLowerCase().includes(filter.toLowerCase()) || (r.callerId ?? '').includes(filter));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Recordings</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {recordings.length} recording{recordings.length !== 1 ? 's' : ''} in <code className="font-mono text-xs bg-secondary px-1 rounded">{directory}</code>
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={load}><RefreshCw className="h-4 w-4" /></Button>
      </div>

      {error && <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>}

      <Input placeholder="Search by filename or caller ID…" value={filter} onChange={e => setFilter(e.target.value)} />

      {loading ? (
        <div className="py-16 text-center text-sm text-muted-foreground">Reading recordings directory…</div>
      ) : visible.length === 0 ? (
        <div className="flex flex-col items-center py-16 gap-3">
          <Mic className="h-10 w-10 text-muted-foreground/20" />
          <p className="text-sm text-muted-foreground">No recordings found. Make sure MixMonitor is configured and the recordings directory is correct.</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map(r => (
            <Card key={r.filename} className="group">
              <CardContent className="pt-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-mono text-xs truncate font-medium">{r.filename}</p>
                    {r.callerId && <p className="text-xs text-muted-foreground">Caller: {r.callerId}</p>}
                  </div>
                  {r.callLogId && <Badge variant="secondary" className="shrink-0 text-[10px]">Linked</Badge>}
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{fmtSize(r.sizeBytes)}</span>
                  <span>{new Date(r.modifiedAt).toLocaleString()}</span>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" className="flex-1" onClick={() => togglePlay(r.filename)}>
                    {playing === r.filename ? <><Pause className="h-3.5 w-3.5" /> Pause</> : <><Play className="h-3.5 w-3.5" /> Play</>}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => download(r.filename)} title="Download">
                    <Download className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
