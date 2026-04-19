'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Separator } from '@/components/ui/separator';
import {
  Plus, Trash2, RefreshCw, Loader2, Phone,
  Pencil, CheckCircle2, Copy, Eye, EyeOff, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

// ARI returns { technology, resource, state, channel_ids }
interface AriEndpoint { technology: string; resource: string; state: string; channel_ids: string[] }

interface FormState {
  extension: string; displayName: string; password: string;
  transport: string; codecs: string[]; maxContacts: string;
  dtmfMode: string; directMedia: boolean;
}

const DEFAULT_FORM: FormState = {
  extension: '', displayName: '', password: '',
  transport: 'transport-udp', codecs: ['ulaw', 'alaw', 'g722'],
  maxContacts: '1', dtmfMode: 'rfc4733', directMedia: false,
};

const CODEC_OPTIONS     = ['ulaw', 'alaw', 'g722', 'g729', 'opus', 'gsm'];
const TRANSPORT_OPTIONS = ['transport-udp', 'transport-tcp', 'transport-tls', 'transport-wss'];

// ── Helpers ───────────────────────────────────────────────────────────────────

function stateColor(s: string) {
  if (s === 'online')       return 'text-success';
  if (s === 'unavailable')  return 'text-destructive';
  return 'text-muted-foreground';
}

function StateDot({ state }: { state: string }) {
  return (
    <span className={cn('text-xs capitalize font-medium flex items-center gap-1.5', stateColor(state))}>
      <span className={cn('inline-block h-1.5 w-1.5 rounded-full', state === 'online' ? 'bg-success' : state === 'unavailable' ? 'bg-destructive' : 'bg-muted-foreground')} />
      {state ?? 'unknown'}
    </span>
  );
}

function CodecPicker({ codecs, onChange }: { codecs: string[]; onChange: (c: string[]) => void }) {
  const toggle = (c: string) => onChange(codecs.includes(c) ? codecs.filter(x => x !== c) : [...codecs, c]);
  return (
    <div className="flex gap-2 flex-wrap">
      {CODEC_OPTIONS.map(c => (
        <button key={c} type="button" onClick={() => toggle(c)}
          className={cn('px-3 py-1 rounded-full text-xs font-mono border transition-colors',
            codecs.includes(c)
              ? 'bg-primary text-primary-foreground border-primary'
              : 'border-border text-muted-foreground hover:border-primary/50')}>
          {c}
        </button>
      ))}
    </div>
  );
}

// ── Extension Form (create / edit) ────────────────────────────────────────────

function ExtensionForm({
  mode, initialId = '', initialValues = DEFAULT_FORM,
  onSave, onCancel, saving, error,
}: {
  mode: 'create' | 'edit';
  initialId?: string;
  initialValues?: FormState;
  onSave: (form: FormState) => void;
  onCancel: () => void;
  saving: boolean;
  error: string;
}) {
  const [form, setForm] = useState<FormState>(initialValues);
  const [showPass, setShowPass] = useState(false);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm(p => ({ ...p, [k]: v }));

  return (
    <Card>
      <CardContent className="pt-4 space-y-4">
        <p className="font-semibold text-sm">
          {mode === 'create' ? 'Create SIP Extension' : `Edit Extension ${initialId}`}
        </p>

        {error && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {mode === 'create' && (
            <div className="space-y-1.5">
              <Label>Extension Number *</Label>
              <Input placeholder="1001" value={form.extension}
                onChange={e => set('extension', e.target.value)} />
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Display Name</Label>
            <Input placeholder="John Smith" value={form.displayName}
              onChange={e => set('displayName', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>{mode === 'create' ? 'SIP Password' : 'New Password (blank = keep current)'}</Label>
            <div className="relative">
              <Input
                type={showPass ? 'text' : 'password'}
                placeholder={mode === 'create' ? 'Auto-generate if blank' : '••••••••'}
                value={form.password}
                onChange={e => set('password', e.target.value)}
                className="pr-9"
              />
              <button type="button" onClick={() => setShowPass(v => !v)}
                className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground">
                {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Transport</Label>
            <Select value={form.transport} onValueChange={v => set('transport', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{TRANSPORT_OPTIONS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>DTMF Mode</Label>
            <Select value={form.dtmfMode} onValueChange={v => set('dtmfMode', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="rfc4733">RFC 4733 (Recommended)</SelectItem>
                <SelectItem value="inband">In-band</SelectItem>
                <SelectItem value="info">SIP INFO</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Max Devices</Label>
            <Select value={form.maxContacts} onValueChange={v => set('maxContacts', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {['1','2','3','5','10'].map(n => (
                  <SelectItem key={n} value={n}>{n} device{n !== '1' ? 's' : ''}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Codecs (select all to allow)</Label>
          <CodecPicker codecs={form.codecs} onChange={c => set('codecs', c)} />
        </div>

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 cursor-pointer text-sm">
            <input type="checkbox" checked={form.directMedia}
              onChange={e => set('directMedia', e.target.checked)}
              className="rounded border-border" />
            Direct Media (peer-to-peer RTP)
          </label>
        </div>

        <div className="flex gap-3">
          <Button onClick={() => onSave(form)} disabled={saving || (mode === 'create' && !form.extension)}>
            {saving
              ? <><Loader2 className="h-4 w-4 animate-spin" /> {mode === 'create' ? 'Creating…' : 'Saving…'}</>
              : mode === 'create' ? 'Create Extension' : 'Save Changes'}
          </Button>
          <Button variant="ghost" type="button" onClick={onCancel}>
            <X className="h-4 w-4 mr-1" /> Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function EndpointsPage() {
  const { accessToken } = useAuth();
  const h = useCallback(() => ({
    Authorization: `Bearer ${accessToken ?? ''}`,
    'Content-Type': 'application/json',
  }), [accessToken]);

  const [endpoints, setEndpoints] = useState<AriEndpoint[]>([]);
  const [loading, setLoading]     = useState(true);
  const [listError, setListError] = useState('');

  // Create state
  const [showCreate, setShowCreate]   = useState(false);
  const [creating, setCreating]       = useState(false);
  const [createError, setCreateError] = useState('');
  const [createdCreds, setCreatedCreds] = useState<{ extension: string; password: string } | null>(null);

  // Edit state
  const [editId, setEditId]         = useState<string | null>(null);
  const [editForm, setEditForm]     = useState<FormState>(DEFAULT_FORM);
  const [saving, setSaving]         = useState(false);
  const [editError, setEditError]   = useState('');

  // Delete state
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // ── Data ──────────────────────────────────────────────────────────────────

  const load = useCallback(() => {
    setLoading(true); setListError('');
    fetch('/api/asterisk/endpoints', { headers: h() })
      .then(r => r.json() as Promise<{ data?: AriEndpoint[]; error?: string }>)
      .then(d => { if (d.error) setListError(d.error); else setEndpoints(d.data ?? []); })
      .catch(e => setListError(String(e)))
      .finally(() => setLoading(false));
  }, [h]);

  useEffect(() => { load(); }, [load]);

  // ── Create ────────────────────────────────────────────────────────────────

  const handleCreate = async (form: FormState) => {
    setCreating(true); setCreateError('');
    try {
      const r = await fetch('/api/asterisk/endpoints', {
        method: 'POST', headers: h(),
        body: JSON.stringify({ ...form, maxContacts: parseInt(form.maxContacts) }),
      });
      const d = await r.json() as { ok: boolean; extension?: string; password?: string; error?: string };
      if (d.ok) {
        setShowCreate(false);
        setCreatedCreds({ extension: d.extension ?? form.extension, password: d.password ?? form.password });
        load();
      } else {
        setCreateError(d.error ?? 'Failed to create endpoint');
      }
    } catch (e) {
      setCreateError(String(e));
    } finally {
      setCreating(false);
    }
  };

  // ── Edit ─────────────────────────────────────────────────────────────────

  const startEdit = async (resource: string) => {
    setEditId(resource); setEditError('');
    try {
      const r = await fetch(`/api/asterisk/endpoints/${encodeURIComponent(resource)}`, { headers: h() });
      const d = await r.json() as { data?: { codecs: string[]; transport: string; dtmfMode: string; directMedia: boolean; maxContacts: string; callerid: string } };
      const data = d.data;
      if (data) {
        const displayName = data.callerid.match(/"([^"]+)"/)?.[1] ?? '';
        setEditForm({ ...DEFAULT_FORM, extension: resource, displayName, password: '', transport: data.transport, codecs: data.codecs, maxContacts: data.maxContacts, dtmfMode: data.dtmfMode, directMedia: data.directMedia });
      }
    } catch { /* use defaults if fetch fails */ }
  };

  const handleEdit = async (form: FormState) => {
    if (!editId) return;
    setSaving(true); setEditError('');
    try {
      const r = await fetch(`/api/asterisk/endpoints/${encodeURIComponent(editId)}`, {
        method: 'PUT', headers: h(),
        body: JSON.stringify({ displayName: form.displayName, password: form.password, transport: form.transport, codecs: form.codecs, maxContacts: parseInt(form.maxContacts), dtmfMode: form.dtmfMode, directMedia: form.directMedia }),
      });
      const d = await r.json() as { ok: boolean; error?: string };
      if (d.ok) { setEditId(null); load(); }
      else setEditError(d.error ?? 'Save failed');
    } catch (e) {
      setEditError(String(e));
    } finally {
      setSaving(false);
    }
  };

  // ── Delete ────────────────────────────────────────────────────────────────

  const handleDelete = async (resource: string) => {
    if (!confirm(`Delete extension ${resource}? This removes the SIP account from Asterisk permanently.`)) return;
    setDeletingId(resource);
    try {
      await fetch(`/api/asterisk/endpoints/${encodeURIComponent(resource)}`, { method: 'DELETE', headers: h() });
      load();
    } finally {
      setDeletingId(null);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">PJSIP Endpoints</h1>
          <p className="text-sm text-muted-foreground mt-1">{endpoints.length} extension{endpoints.length !== 1 ? 's' : ''} configured in Asterisk</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={load} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
          <Button size="sm" onClick={() => { setShowCreate(v => !v); setCreatedCreds(null); }}>
            <Plus className="h-4 w-4" /> New Extension
          </Button>
        </div>
      </div>

      {listError && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">{listError}</div>
      )}

      {/* Created credentials banner */}
      {createdCreds && (
        <div className="rounded-lg border border-success/40 bg-success/5 px-4 py-3 space-y-2">
          <p className="text-sm font-medium text-success flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4" /> Extension {createdCreds.extension} created successfully
          </p>
          <p className="text-xs text-muted-foreground">Save these credentials — the password will not be shown again.</p>
          <div className="grid grid-cols-2 gap-3 max-w-sm">
            {[['Extension / Username', createdCreds.extension], ['SIP Password', createdCreds.password]].map(([label, val]) => (
              <div key={label}>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <code className="text-xs font-mono bg-black/30 px-2 py-0.5 rounded">{val}</code>
                  <button onClick={() => void navigator.clipboard.writeText(val ?? '')} className="text-muted-foreground hover:text-foreground">
                    <Copy className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
          <button onClick={() => setCreatedCreds(null)} className="text-xs text-muted-foreground hover:text-foreground">Dismiss</button>
        </div>
      )}

      {/* Create form */}
      {showCreate && (
        <ExtensionForm
          mode="create"
          onSave={(f) => { void handleCreate(f); }}
          onCancel={() => setShowCreate(false)}
          saving={creating}
          error={createError}
        />
      )}

      {/* Edit form */}
      {editId && (
        <ExtensionForm
          mode="edit"
          initialId={editId}
          initialValues={editForm}
          onSave={(f) => { void handleEdit(f); }}
          onCancel={() => setEditId(null)}
          saving={saving}
          error={editError}
        />
      )}

      {/* Table */}
      <Card>
        <CardContent className="pt-0 px-0">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground text-sm gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading endpoints from Asterisk…
            </div>
          ) : endpoints.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Phone className="h-10 w-10 text-muted-foreground/20" />
              <p className="text-sm text-muted-foreground">No PJSIP endpoints found. Create one above.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Extension</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Active Channels</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {endpoints.map(ep => (
                  <TableRow key={ep.resource} className={editId === ep.resource ? 'bg-primary/5' : undefined}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Phone className="h-3.5 w-3.5 text-muted-foreground/50" />
                        <span className="font-mono font-semibold">{ep.resource}</span>
                      </div>
                    </TableCell>
                    <TableCell><StateDot state={ep.state} /></TableCell>
                    <TableCell className="text-xs text-muted-foreground font-mono">
                      {ep.channel_ids?.length ?? 0}
                      {(ep.channel_ids?.length ?? 0) > 0 && (
                        <Badge variant="secondary" className="ml-2 text-[10px]">active</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button size="sm" variant="ghost"
                          onClick={() => { void startEdit(ep.resource); }}
                          disabled={editId === ep.resource}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost"
                          className="text-destructive hover:text-destructive"
                          disabled={deletingId === ep.resource}
                          onClick={() => { void handleDelete(ep.resource); }}>
                          {deletingId === ep.resource
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            : <Trash2 className="h-3.5 w-3.5" />}
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

      {/* SIP client config hint */}
      <Card className="border-border/50 bg-muted/20">
        <CardContent className="pt-4 text-xs text-muted-foreground space-y-1.5">
          <p className="font-medium text-foreground text-sm">SIP Client Configuration</p>
          <div className="grid sm:grid-cols-2 gap-x-8 gap-y-1">
            {[
              ['Server', 'your-asterisk-ip'],
              ['Port', '5060 (UDP/TCP) or 5061 (TLS)'],
              ['Username', 'Extension number (e.g. 1001)'],
              ['Context', 'agents'],
            ].map(([k, v]) => (
              <p key={k}><span className="text-muted-foreground/60">{k}:</span>{' '}
                <code className="font-mono bg-black/20 px-1 rounded">{v}</code>
              </p>
            ))}
          </div>
          <p className="text-muted-foreground/60 pt-1">Register any SIP softphone (Zoiper, Linphone, Bria) using these settings.</p>
        </CardContent>
      </Card>
    </div>
  );
}
