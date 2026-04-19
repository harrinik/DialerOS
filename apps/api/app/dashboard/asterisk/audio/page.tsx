'use client';

import { useEffect, useRef, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Upload, Trash2, Play, Pause, Music, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AudioFile { _id: string; name: string; originalName: string; category: string; asteriskPath: string; durationSecs?: number; sizeBytes: number; createdAt: string }

const CATEGORIES = ['ivr', 'moh', 'greeting', 'misc'];
const CATEGORY_COLOR: Record<string, string> = { ivr: 'running', moh: 'paused', greeting: 'draft', misc: 'secondary' };

function fmtDuration(s?: number) { if (!s) return '—'; return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`; }
function fmtSize(b: number) { return b > 1_000_000 ? `${(b / 1_000_000).toFixed(1)} MB` : `${(b / 1000).toFixed(0)} KB`; }

export default function AudioLibraryPage() {
  const [files, setFiles] = useState<AudioFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadName, setUploadName] = useState('');
  const [uploadCategory, setUploadCategory] = useState('ivr');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [playing, setPlaying] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const token = () => localStorage.getItem('dialer_access_token') ?? '';
  const h = () => ({ Authorization: `Bearer ${token()}` });

  const load = () => {
    setLoading(true);
    fetch('/api/asterisk/audio', { headers: h() }).then(r => r.json())
      .then((d: { data: AudioFile[] }) => setFiles(d.data ?? []))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const upload = async () => {
    if (!selectedFile || !uploadName) return;
    setUploading(true); setError('');
    const fd = new FormData();
    fd.append('file', selectedFile);
    fd.append('name', uploadName);
    fd.append('category', uploadCategory);
    const r = await fetch('/api/asterisk/audio', { method: 'POST', headers: h(), body: fd });
    const d = await r.json() as { data?: AudioFile; error?: string };
    setUploading(false);
    if (d.error) setError(d.error);
    else { setSelectedFile(null); setUploadName(''); if (fileInputRef.current) fileInputRef.current.value = ''; load(); }
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this audio file?')) return;
    await fetch(`/api/asterisk/audio/${id}`, { method: 'DELETE', headers: h() });
    load();
  };

  const togglePlay = (id: string) => {
    if (playing === id) { audioRef.current?.pause(); setPlaying(null); return; }
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ''; }
    const audio = new Audio(`/api/asterisk/audio/${id}/stream`);
    audioRef.current = audio;
    audio.play().catch(() => setError('Could not play audio file'));
    audio.onended = () => setPlaying(null);
    setPlaying(id);
  };

  const visible = files.filter(f => !filter || f.name.includes(filter) || f.category === filter || f.asteriskPath.includes(filter));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold">Audio Library</h1><p className="text-sm text-muted-foreground mt-1">{files.length} files · Auto-converted to 8kHz WAV for Asterisk</p></div>
      </div>

      {error && <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>}

      {/* Upload card */}
      <Card>
        <CardContent className="pt-4 space-y-4">
          <p className="font-semibold text-sm">Upload Audio File</p>
          <p className="text-xs text-muted-foreground">Supports WAV, MP3, OGG, M4A, FLAC — auto-converted to 8kHz 16-bit mono WAV on upload.</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>File</Label>
              <input ref={fileInputRef} type="file" accept=".wav,.mp3,.ogg,.m4a,.flac,.aiff" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) { setSelectedFile(f); if (!uploadName) setUploadName(f.name.replace(/\.[^.]+$/, '')); } }} />
              <button onClick={() => fileInputRef.current?.click()}
                className={cn('w-full border border-dashed rounded-lg px-4 py-3 text-sm transition-colors hover:border-primary/50 hover:bg-primary/5 flex items-center justify-center gap-2', selectedFile ? 'border-primary/40 text-primary' : 'border-border text-muted-foreground')}>
                <Upload className="h-4 w-4" />
                {selectedFile ? selectedFile.name : 'Click to choose file'}
              </button>
            </div>
            <div className="space-y-1.5"><Label>Audio Name (Asterisk path)</Label><Input placeholder="welcome_message" value={uploadName} onChange={e => setUploadName(e.target.value.replace(/\s+/g, '_').toLowerCase())} /></div>
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select value={uploadCategory} onValueChange={setUploadCategory}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{CATEGORIES.map(c => <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          {selectedFile && uploadName && (
            <div className="text-xs text-muted-foreground">
              Will be saved as: <code className="bg-secondary px-1 rounded font-mono">{uploadCategory}/{uploadName}.wav</code>
              · Asterisk PlayBack path: <code className="bg-secondary px-1 rounded font-mono">dialer/{uploadCategory}/{uploadName}</code>
            </div>
          )}
          <Button onClick={upload} disabled={uploading || !selectedFile || !uploadName}>
            {uploading ? <><Loader2 className="h-4 w-4 animate-spin" /> Converting &amp; uploading…</> : <><Upload className="h-4 w-4" /> Upload</>}
          </Button>
        </CardContent>
      </Card>

      {/* Filter */}
      <Input placeholder="Search by name, path, or category…" value={filter} onChange={e => setFilter(e.target.value)} />

      {/* Files grid */}
      {loading ? <div className="py-16 text-center text-sm text-muted-foreground">Loading audio library…</div> : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map(f => (
            <Card key={f._id} className="group">
              <CardContent className="pt-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">{f.name}</p>
                    <p className="text-xs text-muted-foreground font-mono truncate">{f.asteriskPath}</p>
                  </div>
                  <Badge variant={(CATEGORY_COLOR[f.category] ?? 'secondary') as 'running' | 'secondary'}>{f.category}</Badge>
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{fmtDuration(f.durationSecs)}</span>
                  <span>{fmtSize(f.sizeBytes)}</span>
                  <span>{new Date(f.createdAt).toLocaleDateString()}</span>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" className="flex-1" onClick={() => togglePlay(f._id)}>
                    {playing === f._id ? <><Pause className="h-3.5 w-3.5" /> Pause</> : <><Play className="h-3.5 w-3.5" /> Preview</>}
                  </Button>
                  <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => void remove(f._id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              </CardContent>
            </Card>
          ))}
          {visible.length === 0 && (
            <div className="col-span-3 flex flex-col items-center py-16 gap-3">
              <Music className="h-10 w-10 text-muted-foreground/20" />
              <p className="text-sm text-muted-foreground">No audio files yet. Upload your IVR prompts above.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
