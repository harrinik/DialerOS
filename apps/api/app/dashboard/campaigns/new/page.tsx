'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, Loader2, AlertCircle, Phone, Settings2, Clock } from 'lucide-react';

const TIMEZONES = [
  'UTC', 'America/New_York', 'America/Chicago', 'America/Denver',
  'America/Los_Angeles', 'America/Toronto', 'Europe/London', 'Europe/Paris',
  'Europe/Berlin', 'Europe/Moscow', 'Asia/Dubai', 'Asia/Riyadh',
  'Asia/Kolkata', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney',
];

interface FormState {
  name: string;
  description: string;
  callerIdName: string;
  callerIdNumber: string;
  sipTrunk: string;
  dialMode: 'preview' | 'progressive' | 'predictive';
  concurrency: number;
  ratePerSecond: number;
  amdAction: 'hangup' | 'continue';
  timezone: string;
  startTime: string;
  endTime: string;
  blackoutDates: string;
}

const DEFAULTS: FormState = {
  name: '',
  description: '',
  callerIdName: '',
  callerIdNumber: '',
  sipTrunk: '',
  dialMode: 'progressive',
  concurrency: 5,
  ratePerSecond: 1,
  amdAction: 'hangup',
  timezone: 'UTC',
  startTime: '',
  endTime: '',
  blackoutDates: '',
};

export default function NewCampaignPage() {
  const router = useRouter();
  const { accessToken } = useAuth();
  const [form, setForm] = useState<FormState>(DEFAULTS);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof FormState>(key: K, val: FormState[K]) =>
    setForm(p => ({ ...p, [key]: val }));

  const headers = () => ({
    Authorization: `Bearer ${accessToken ?? ''}`,
    'Content-Type': 'application/json',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        name:           form.name.trim(),
        callerIdName:   form.callerIdName.trim(),
        callerIdNumber: form.callerIdNumber.trim(),
        sipTrunk:       form.sipTrunk.trim(),
        dialMode:       form.dialMode,
        concurrency:    form.concurrency,
        ratePerSecond:  form.ratePerSecond,
        amdAction:      form.amdAction,
        timezone:       form.timezone,
      };
      if (form.description.trim()) payload.description = form.description.trim();
      if (form.startTime)          payload.startTime   = form.startTime;
      if (form.endTime)            payload.endTime     = form.endTime;
      const blackoutDates = form.blackoutDates
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
      if (blackoutDates.length) payload.blackoutDates = blackoutDates;

      const r = await fetch('/api/campaigns', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(payload),
      });

      if (!r.ok) {
        const body = await r.json() as { error?: string; details?: { fieldErrors?: Record<string, string[]> } };
        // Show field-level validation errors if present
        const fieldErrors = body.details?.fieldErrors;
        if (fieldErrors) {
          const msgs = Object.entries(fieldErrors).map(([f, errs]) => `${f}: ${errs.join(', ')}`).join('\n');
          setError(msgs);
        } else {
          setError(body.error ?? 'Failed to create campaign');
        }
        return;
      }

      const data = await r.json() as { data: { _id: string } };
      router.push(`/dashboard/campaigns/${data.data._id}`);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
          <Link href="/dashboard/campaigns" className="hover:text-foreground transition-colors flex items-center gap-1">
            <ArrowLeft className="h-3.5 w-3.5" /> Campaigns
          </Link>
          <span>/</span>
          <span className="text-foreground font-medium">New Campaign</span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight">Create Campaign</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Set up a new outbound dialing campaign. It will be saved as a draft — start it when ready.
        </p>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive whitespace-pre-line">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={(e) => { void handleSubmit(e); }} className="space-y-6">

        {/* Basic Info */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Phone className="h-4 w-4 text-primary" /> Basic Information
            </CardTitle>
          </CardHeader>
          <Separator />
          <CardContent className="pt-4 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="camp-name">Campaign Name <span className="text-destructive">*</span></Label>
              <Input
                id="camp-name"
                value={form.name}
                onChange={e => set('name', e.target.value)}
                placeholder="e.g. Q2 Outbound Sales"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="camp-desc">Description</Label>
              <textarea
                id="camp-desc"
                value={form.description}
                onChange={e => set('description', e.target.value)}
                placeholder="Optional notes about this campaign..."
                rows={2}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="camp-cid-name">Caller ID Name <span className="text-destructive">*</span></Label>
                <Input
                  id="camp-cid-name"
                  value={form.callerIdName}
                  onChange={e => set('callerIdName', e.target.value)}
                  placeholder="My Company"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="camp-cid-num">Caller ID Number <span className="text-destructive">*</span></Label>
                <Input
                  id="camp-cid-num"
                  value={form.callerIdNumber}
                  onChange={e => set('callerIdNumber', e.target.value)}
                  placeholder="+12125550100"
                  required
                />
                <p className="text-xs text-muted-foreground">E.164 format, e.g. +12125550100</p>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="camp-trunk">SIP Trunk <span className="text-destructive">*</span></Label>
              <Input
                id="camp-trunk"
                value={form.sipTrunk}
                onChange={e => set('sipTrunk', e.target.value)}
                placeholder="trunk-main (name from Asterisk → SIP Trunks)"
                required
              />
              <p className="text-xs text-muted-foreground">
                Must match the trunk name configured in <Link href="/dashboard/asterisk/trunks" className="underline">Asterisk → SIP Trunks</Link>.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Dialing Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Settings2 className="h-4 w-4 text-primary" /> Dialing Settings
            </CardTitle>
          </CardHeader>
          <Separator />
          <CardContent className="pt-4 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Dial Mode</Label>
                <Select value={form.dialMode} onValueChange={v => set('dialMode', v as FormState['dialMode'])}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="progressive">Progressive — dial at a fixed rate</SelectItem>
                    <SelectItem value="predictive">Predictive — dial ahead of agents</SelectItem>
                    <SelectItem value="preview">Preview — agent-initiated</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="camp-amd">Answering Machine Detection</Label>
                <Select value={form.amdAction} onValueChange={v => set('amdAction', v as FormState['amdAction'])}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hangup">Hangup on machine</SelectItem>
                    <SelectItem value="continue">Continue on machine</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="camp-concurrency">Concurrency (simultaneous calls)</Label>
                <Input
                  id="camp-concurrency"
                  type="number" min={1} max={500}
                  value={form.concurrency}
                  onChange={e => set('concurrency', parseInt(e.target.value) || 1)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="camp-rate">Dial Rate (calls/second)</Label>
                <Input
                  id="camp-rate"
                  type="number" min={0.1} max={100} step={0.1}
                  value={form.ratePerSecond}
                  onChange={e => set('ratePerSecond', parseFloat(e.target.value) || 1)}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Schedule */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="h-4 w-4 text-primary" /> Schedule (optional)
            </CardTitle>
          </CardHeader>
          <Separator />
          <CardContent className="pt-4 space-y-4">
            <div className="space-y-1.5">
              <Label>Timezone</Label>
              <Select value={form.timezone} onValueChange={v => set('timezone', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TIMEZONES.map(tz => <SelectItem key={tz} value={tz}>{tz}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="camp-start">Daily Start Time (HH:MM)</Label>
                <Input
                  id="camp-start"
                  type="time"
                  value={form.startTime}
                  onChange={e => set('startTime', e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="camp-end">Daily End Time (HH:MM)</Label>
                <Input
                  id="camp-end"
                  type="time"
                  value={form.endTime}
                  onChange={e => set('endTime', e.target.value)}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Leave blank for no time restriction. Dialing outside these hours will be paused automatically.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="camp-blackout">Blackout Dates (optional)</Label>
              <Input
                id="camp-blackout"
                value={form.blackoutDates}
                onChange={e => set('blackoutDates', e.target.value)}
                placeholder="2026-12-25, 2026-01-01"
              />
              <p className="text-xs text-muted-foreground">
                Comma-separated local dates (YYYY-MM-DD). Calls are blocked all day in campaign timezone.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Actions */}
        <div className="flex gap-3">
          <Button type="submit" disabled={saving}>
            {saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Creating…</> : 'Create Campaign'}
          </Button>
          <Link href="/dashboard/campaigns">
            <Button type="button" variant="ghost">Cancel</Button>
          </Link>
        </div>

      </form>
    </div>
  );
}
