'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { parsePastedPhoneInput } from '@dialer/shared';
import { useAuth } from '@/lib/auth/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowLeft, Loader2, AlertCircle, Phone, Settings2, Clock, ListOrdered, PhoneCall } from 'lucide-react';

const TIMEZONES = [
  'UTC', 'America/New_York', 'America/Chicago', 'America/Denver',
  'America/Los_Angeles', 'America/Toronto', 'Europe/London', 'Europe/Paris',
  'Europe/Berlin', 'Europe/Moscow', 'Asia/Dubai', 'Asia/Riyadh',
  'Asia/Kolkata', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney',
];

type CreationMode = 'campaign' | 'single';

interface TrunkOption {
  id: string;
  state: string;
}

interface IvrFlowOption {
  _id: string;
  name: string;
  isDeployed: boolean;
}

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
  ivrFlowId: string;
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
  ivrFlowId: '',
  timezone: 'UTC',
  startTime: '',
  endTime: '',
  blackoutDates: '',
};

export default function NewCampaignPage() {
  const router = useRouter();
  const { accessToken } = useAuth();
  const [form, setForm] = useState<FormState>(DEFAULTS);
  const [creationMode, setCreationMode] = useState<CreationMode>('campaign');
  const [pastedNumbers, setPastedNumbers] = useState('');
  const [singleNumber, setSingleNumber] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trunks, setTrunks] = useState<TrunkOption[]>([]);
  const [trunksLoading, setTrunksLoading] = useState(true);
  const [trunksError, setTrunksError] = useState<string | null>(null);
  const [ivrFlows, setIvrFlows] = useState<IvrFlowOption[]>([]);

  const set = <K extends keyof FormState>(key: K, val: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: val }));

  const headers = () => ({
    Authorization: `Bearer ${accessToken ?? ''}`,
    'Content-Type': 'application/json',
  });

  const audienceInput = creationMode === 'single' ? singleNumber : pastedNumbers;
  const audiencePreview = parsePastedPhoneInput(audienceInput);
  const activeTrunks = trunks.filter((trunk) => trunk.state === 'online');

  useEffect(() => {
    if (!accessToken) return;

    let cancelled = false;
    setTrunksLoading(true);
    setTrunksError(null);

    fetch('/api/asterisk/trunks', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    })
      .then(async (response) => {
        const body = await response.json() as { data?: TrunkOption[]; error?: string };
        if (!response.ok) {
          throw new Error(body.error ?? 'Failed to load SIP trunks.');
        }
        if (cancelled) return;
        setTrunks(body.data ?? []);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setTrunks([]);
        setTrunksError(String(err));
      })
      .finally(() => {
        if (!cancelled) setTrunksLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  useEffect(() => {
    if (!accessToken) return;
    fetch('/api/ivr-flows', { headers: { Authorization: `Bearer ${accessToken}` } })
      .then((r) => r.json() as Promise<{ data: IvrFlowOption[] }>)
      .then((d) => setIvrFlows(d.data ?? []))
      .catch(() => null);
  }, [accessToken]);

  useEffect(() => {
    setForm((prev) => {
      if (prev.sipTrunk && !activeTrunks.some((trunk) => trunk.id === prev.sipTrunk)) {
        return { ...prev, sipTrunk: '' };
      }
      const firstActiveTrunk = activeTrunks[0]?.id;
      if (!prev.sipTrunk && firstActiveTrunk) {
        return { ...prev, sipTrunk: firstActiveTrunk };
      }
      return prev;
    });
  }, [activeTrunks]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);

    try {
      const numbersText = creationMode === 'single' ? singleNumber.trim() : pastedNumbers.trim();
      if (creationMode === 'single' && !numbersText) {
        setError('Enter the phone number you want to dial.');
        return;
      }

      const resolvedName = creationMode === 'single'
        ? (form.name.trim() || `Quick Dial ${audiencePreview.valid[0] ?? numbersText}`)
        : form.name.trim();

      const payload: Record<string, unknown> = {
        name: resolvedName,
        callerIdName: form.callerIdName.trim(),
        callerIdNumber: form.callerIdNumber.trim(),
        sipTrunk: form.sipTrunk.trim(),
        dialMode: form.dialMode,
        concurrency: creationMode === 'single' ? 1 : form.concurrency,
        ratePerSecond: creationMode === 'single' ? 1 : form.ratePerSecond,
        amdAction: form.amdAction,
        timezone: form.timezone,
        launchMode: creationMode === 'single' ? 'dial_now' : 'campaign',
      };

      if (form.description.trim()) payload.description = form.description.trim();
      if (form.ivrFlowId) payload.ivrFlowId = form.ivrFlowId;
      if (form.startTime) payload.startTime = form.startTime;
      if (form.endTime) payload.endTime = form.endTime;
      if (numbersText) payload.numbersText = numbersText;

      const blackoutDates = form.blackoutDates
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
      if (blackoutDates.length) payload.blackoutDates = blackoutDates;

      const response = await fetch('/api/campaigns', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const body = await response.json() as {
          error?: string;
          details?: { fieldErrors?: Record<string, string[]>; valid?: number; invalid?: number; duplicates?: number; dnc?: number };
        };
        const fieldErrors = body.details?.fieldErrors;
        if (fieldErrors) {
          const messages = Object.entries(fieldErrors)
            .map(([field, errors]) => `${field}: ${errors.join(', ')}`)
            .join('\n');
          setError(messages);
        } else {
          const stats = body.details && 'valid' in body.details
            ? `\nValid: ${body.details.valid ?? 0}, Invalid: ${body.details.invalid ?? 0}, Duplicates: ${body.details.duplicates ?? 0}, DNC: ${body.details.dnc ?? 0}`
            : '';
          setError(`${body.error ?? 'Failed to create campaign'}${stats}`);
        }
        return;
      }

      const data = await response.json() as { data: { _id: string } };
      router.push(`/dashboard/campaigns/${data.data._id}`);
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <div className="mb-1 flex items-center gap-2 text-sm text-muted-foreground">
          <Link href="/dashboard/campaigns" className="flex items-center gap-1 transition-colors hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" /> Campaigns
          </Link>
          <span>/</span>
          <span className="font-medium text-foreground">New Campaign</span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight">Create Campaign</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Create a full campaign with pasted numbers or place a one-off call to a single number immediately.
        </p>
      </div>

      {error && (
        <div className="flex items-start gap-2 whitespace-pre-line rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={(e) => { void handleSubmit(e); }} className="space-y-6">
        <Tabs value={creationMode} onValueChange={(value) => setCreationMode(value as CreationMode)}>
          <TabsList>
            <TabsTrigger value="campaign"><ListOrdered className="mr-2 h-4 w-4" /> Create Campaign</TabsTrigger>
            <TabsTrigger value="single"><PhoneCall className="mr-2 h-4 w-4" /> Dial One Number</TabsTrigger>
          </TabsList>
        </Tabs>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Phone className="h-4 w-4 text-primary" /> Basic Information
            </CardTitle>
          </CardHeader>
          <Separator />
          <CardContent className="space-y-4 pt-4">
            <div className="space-y-1.5">
              <Label htmlFor="camp-name">
                {creationMode === 'single' ? 'Call Label' : 'Campaign Name'}
                {creationMode === 'campaign' && <span className="text-destructive"> *</span>}
              </Label>
              <Input
                id="camp-name"
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder={creationMode === 'single' ? 'Optional label for this one-off call' : 'e.g. Q2 Outbound Sales'}
                required={creationMode === 'campaign'}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="camp-desc">Description</Label>
              <textarea
                id="camp-desc"
                value={form.description}
                onChange={(e) => set('description', e.target.value)}
                placeholder="Optional notes about this campaign..."
                rows={2}
                className="flex w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="camp-cid-name">Caller ID Name <span className="text-destructive">*</span></Label>
                <Input
                  id="camp-cid-name"
                  value={form.callerIdName}
                  onChange={(e) => set('callerIdName', e.target.value)}
                  placeholder="My Company"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="camp-cid-num">Caller ID Number <span className="text-destructive">*</span></Label>
                <Input
                  id="camp-cid-num"
                  value={form.callerIdNumber}
                  onChange={(e) => set('callerIdNumber', e.target.value)}
                  placeholder="+12125550100"
                  required
                />
                <p className="text-xs text-muted-foreground">E.164 format, e.g. +12125550100</p>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="camp-trunk">SIP Trunk <span className="text-destructive">*</span></Label>
              <Select
                value={form.sipTrunk}
                onValueChange={(value) => set('sipTrunk', value)}
                disabled={trunksLoading || activeTrunks.length === 0}
              >
                <SelectTrigger id="camp-trunk">
                  <SelectValue placeholder={trunksLoading ? 'Loading active SIP trunks...' : 'Select an active SIP trunk'} />
                </SelectTrigger>
                <SelectContent>
                  {activeTrunks.map((trunk) => (
                    <SelectItem key={trunk.id} value={trunk.id}>
                      {trunk.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Must match the trunk name configured in{' '}
                <Link href="/dashboard/asterisk/trunks" className="underline">
                  Asterisk -&gt; SIP Trunks
                </Link>.
              </p>
              {trunksError && (
                <p className="text-xs text-destructive">{trunksError}</p>
              )}
              {!trunksLoading && activeTrunks.length === 0 && !trunksError && (
                <p className="text-xs text-warning">
                  No active SIP trunks are available right now. Bring a trunk online before starting a campaign.
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              {creationMode === 'single'
                ? <><PhoneCall className="h-4 w-4 text-primary" /> Number to Dial</>
                : <><ListOrdered className="h-4 w-4 text-primary" /> Numbers</>}
            </CardTitle>
          </CardHeader>
          <Separator />
          <CardContent className="space-y-4 pt-4">
            {creationMode === 'single' ? (
              <div className="space-y-1.5">
                <Label htmlFor="single-number">Phone Number <span className="text-destructive">*</span></Label>
                <Input
                  id="single-number"
                  value={singleNumber}
                  onChange={(e) => setSingleNumber(e.target.value)}
                  placeholder="+12125550100"
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Use international format when possible. Spaces, dashes, parentheses, and 00 prefixes are cleaned up automatically.
                </p>
              </div>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="pasted-numbers">Paste Numbers</Label>
                  <textarea
                    id="pasted-numbers"
                    value={pastedNumbers}
                    onChange={(e) => setPastedNumbers(e.target.value)}
                    placeholder={'+12125550100\n+442071838750\n+254712345678'}
                    rows={8}
                    className="flex min-h-36 w-full resize-y rounded-md border border-input bg-background px-3 py-2 font-mono text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  />
                  <p className="text-xs text-muted-foreground">
                    Paste one number per line for best results. Comma-separated lists also work. Leave this blank if you want to upload a CSV or TXT later.
                  </p>
                </div>

                <div className="space-y-1 rounded-md border border-border/60 bg-secondary/30 px-3 py-3 text-xs text-muted-foreground">
                  <p className="font-medium text-foreground">Recommended format</p>
                  <p>Use full international numbers like +12125550100 or +254712345678.</p>
                  <p>We automatically strip spaces, dashes, parentheses, and convert 00 prefixes to +.</p>
                </div>
              </>
            )}

            {!!audienceInput.trim() && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="rounded-md border border-border/60 px-3 py-2">
                  <p className="text-xs text-muted-foreground">Ready to import</p>
                  <p className="text-lg font-semibold text-foreground">{audiencePreview.valid.length}</p>
                </div>
                <div className="rounded-md border border-border/60 px-3 py-2">
                  <p className="text-xs text-muted-foreground">Invalid</p>
                  <p className="text-lg font-semibold text-warning">{audiencePreview.invalid.length}</p>
                </div>
                <div className="rounded-md border border-border/60 px-3 py-2">
                  <p className="text-xs text-muted-foreground">Duplicates removed</p>
                  <p className="text-lg font-semibold text-muted-foreground">{audiencePreview.duplicates.length}</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Settings2 className="h-4 w-4 text-primary" /> Dialing Settings
            </CardTitle>
          </CardHeader>
          <Separator />
          <CardContent className="space-y-4 pt-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Dial Mode</Label>
                <Select value={form.dialMode} onValueChange={(value) => set('dialMode', value as FormState['dialMode'])}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="progressive">Progressive - dial at a fixed rate</SelectItem>
                    <SelectItem value="predictive">Predictive - dial ahead of agents</SelectItem>
                    <SelectItem value="preview">Preview - agent-initiated</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="camp-amd">Answering Machine Detection</Label>
                <Select value={form.amdAction} onValueChange={(value) => set('amdAction', value as FormState['amdAction'])}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hangup">Hangup on machine</SelectItem>
                    <SelectItem value="continue">Continue on machine</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>IVR Flow (optional)</Label>
              <Select value={form.ivrFlowId} onValueChange={(value) => set('ivrFlowId', value === 'none' ? '' : value)}>
                <SelectTrigger><SelectValue placeholder="No IVR — route directly to agent" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No IVR — direct agent routing</SelectItem>
                  {ivrFlows.map((f) => (
                    <SelectItem key={f._id} value={f._id}>
                      {f.name}{f.isDeployed ? '' : ' (draft)'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                When set, callers hear this IVR before being routed. Use the{' '}
                <a href="/dashboard/ivr-builder" className="underline">IVR Builder</a>{' '}
                to create a flow with a Play → Forward Call sequence for 3CX ring groups.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="camp-concurrency">Concurrency (simultaneous calls)</Label>
                <Input
                  id="camp-concurrency"
                  type="number"
                  min={1}
                  max={500}
                  value={creationMode === 'single' ? 1 : form.concurrency}
                  onChange={(e) => set('concurrency', parseInt(e.target.value) || 1)}
                  disabled={creationMode === 'single'}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="camp-rate">Dial Rate (calls/second)</Label>
                <Input
                  id="camp-rate"
                  type="number"
                  min={0.1}
                  max={100}
                  step={0.1}
                  value={creationMode === 'single' ? 1 : form.ratePerSecond}
                  onChange={(e) => set('ratePerSecond', parseFloat(e.target.value) || 1)}
                  disabled={creationMode === 'single'}
                />
              </div>
            </div>

            {creationMode === 'single' && (
              <p className="text-xs text-muted-foreground">
                Single-number mode always queues exactly one call with concurrency 1.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock className="h-4 w-4 text-primary" /> Schedule (optional)
            </CardTitle>
          </CardHeader>
          <Separator />
          <CardContent className="space-y-4 pt-4">
            <div className="space-y-1.5">
              <Label>Timezone</Label>
              <Select value={form.timezone} onValueChange={(value) => set('timezone', value)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TIMEZONES.map((timezone) => <SelectItem key={timezone} value={timezone}>{timezone}</SelectItem>)}
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
                  onChange={(e) => set('startTime', e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="camp-end">Daily End Time (HH:MM)</Label>
                <Input
                  id="camp-end"
                  type="time"
                  value={form.endTime}
                  onChange={(e) => set('endTime', e.target.value)}
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
                onChange={(e) => set('blackoutDates', e.target.value)}
                placeholder="2026-12-25, 2026-01-01"
              />
              <p className="text-xs text-muted-foreground">
                Comma-separated local dates (YYYY-MM-DD). Calls are blocked all day in the campaign timezone.
              </p>
            </div>
          </CardContent>
        </Card>

        <div className="flex gap-3">
          <Button type="submit" disabled={saving || trunksLoading || activeTrunks.length === 0}>
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {creationMode === 'single' ? 'Dialing...' : 'Creating...'}
              </>
            ) : (
              creationMode === 'single' ? 'Dial Number Now' : 'Create Campaign'
            )}
          </Button>
          <Link href="/dashboard/campaigns">
            <Button type="button" variant="ghost">Cancel</Button>
          </Link>
        </div>
      </form>
    </div>
  );
}
