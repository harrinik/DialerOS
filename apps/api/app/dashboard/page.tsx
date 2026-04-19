'use client';

import { useEffect, useState, useCallback } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { RealtimeCallEvent } from '@dialer/shared';
import { SOCKET_EVENTS } from '@dialer/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Phone, CheckCircle, Bot, XCircle, Wifi, WifiOff } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ActiveCall {
  callLogId: string; phone?: string; campaignId: string; status: string; startedAt: string;
}
interface SystemStats {
  activeCalls: number; answeredToday: number; machinesToday: number; failedToday: number;
}

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  dialing:  { label: 'Dialing',  color: 'text-primary' },
  answered: { label: 'Answered', color: 'text-success' },
  machine:  { label: 'Machine',  color: 'text-warning' },
  ringing:  { label: 'Ringing',  color: 'text-primary' },
  routed:   { label: 'Routed',   color: 'text-accent-foreground' },
};

const EVENT_COLORS: Record<string, string> = {
  'call:started':  'text-primary',
  'call:answered': 'text-success',
  'call:machine':  'text-warning',
  'call:ended':    'text-muted-foreground',
  'call:failed':   'text-destructive',
};

export default function DashboardPage() {
  const [isConnected, setIsConnected] = useState(false);
  const [activeCalls, setActiveCalls] = useState<ActiveCall[]>([]);
  const [recentEvents, setRecentEvents] = useState<RealtimeCallEvent[]>([]);
  const [stats, setStats] = useState<SystemStats>({ activeCalls: 0, answeredToday: 0, machinesToday: 0, failedToday: 0 });

  const addEvent = useCallback((event: RealtimeCallEvent) => {
    setRecentEvents((prev) => [event, ...prev].slice(0, 50));
  }, []);

  useEffect(() => {
    const s: Socket = io(process.env['NEXT_PUBLIC_GATEWAY_URL'] ?? 'http://localhost:3001', {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: Infinity,
    });

    s.on('connect', () => { setIsConnected(true); s.emit('subscribe:campaign', 'global'); });
    s.on('disconnect', () => setIsConnected(false));

    s.on(SOCKET_EVENTS.CALL_STARTED, (e: RealtimeCallEvent) => {
      const call: ActiveCall = {
        callLogId: e.callLogId,
        campaignId: e.campaignId,
        status: 'dialing',
        startedAt: e.timestamp,
        ...(e.phone !== undefined && { phone: e.phone }),
      };
      setActiveCalls((p) => [...p, call]);
      addEvent(e);
    });
    s.on(SOCKET_EVENTS.CALL_ANSWERED, (e: RealtimeCallEvent) => {
      setActiveCalls((p) => p.map((c) => c.callLogId === e.callLogId ? { ...c, status: 'answered' } : c));
      setStats((s) => ({ ...s, answeredToday: s.answeredToday + 1 }));
      addEvent(e);
    });
    s.on(SOCKET_EVENTS.CALL_MACHINE, (e: RealtimeCallEvent) => {
      setActiveCalls((p) => p.map((c) => c.callLogId === e.callLogId ? { ...c, status: 'machine' } : c));
      setStats((s) => ({ ...s, machinesToday: s.machinesToday + 1 }));
      addEvent(e);
    });
    s.on(SOCKET_EVENTS.CALL_ENDED, (e: RealtimeCallEvent) => {
      setActiveCalls((p) => p.filter((c) => c.callLogId !== e.callLogId));
      addEvent(e);
    });
    s.on(SOCKET_EVENTS.CALL_FAILED, (e: RealtimeCallEvent) => {
      setActiveCalls((p) => p.filter((c) => c.callLogId !== e.callLogId));
      setStats((s) => ({ ...s, failedToday: s.failedToday + 1 }));
      addEvent(e);
    });

    return () => { s.disconnect(); };
  }, [addEvent]);

  useEffect(() => {
    setStats((s) => ({ ...s, activeCalls: activeCalls.length }));
  }, [activeCalls]);

  const kpis = [
    { label: 'Active Calls', value: stats.activeCalls, icon: Phone, color: 'text-primary', pulse: stats.activeCalls > 0 },
    { label: 'Answered Today', value: stats.answeredToday, icon: CheckCircle, color: 'text-success', pulse: false },
    { label: 'Machines', value: stats.machinesToday, icon: Bot, color: 'text-warning', pulse: false },
    { label: 'Failed', value: stats.failedToday, icon: XCircle, color: 'text-destructive', pulse: false },
  ];

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">Live Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">Real-time call activity and system health</p>
        </div>
        <div className="flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium">
          {isConnected
            ? <><Wifi className="h-3 w-3 text-success" /><span className="text-success">Live</span></>
            : <><WifiOff className="h-3 w-3 text-muted-foreground" /><span className="text-muted-foreground">Disconnected</span></>
          }
        </div>
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4 mb-6">
        {kpis.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <Card key={kpi.label} className="relative overflow-hidden">
              <CardContent className="pt-6">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium mb-1">{kpi.label}</p>
                    <p className={cn('text-3xl font-bold tabular-nums', kpi.color, kpi.pulse && 'animate-pulse-ring')}>{kpi.value}</p>
                  </div>
                  <div className={cn('rounded-lg p-2 bg-secondary', kpi.color)}>
                    <Icon className="h-4 w-4" />
                  </div>
                </div>
              </CardContent>
              {/* gradient top bar */}
              <div className={cn('absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-primary to-accent opacity-0 group-hover:opacity-100 transition-opacity')} />
            </Card>
          );
        })}
      </div>

      {/* Active calls + Event feed */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Active calls */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Active Calls</CardTitle>
              <Badge variant={activeCalls.length > 0 ? 'running' : 'secondary'}>
                {activeCalls.length} live
              </Badge>
            </div>
          </CardHeader>
          <Separator className="mb-0" />
          <CardContent className="pt-0">
            {activeCalls.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <Phone className="h-8 w-8 mb-2 opacity-30" />
                <p className="text-sm">No active calls</p>
              </div>
            ) : (
              <table className="w-full text-sm mt-3">
                <thead>
                  <tr className="text-xs uppercase tracking-wide text-muted-foreground border-b border-border">
                    <th className="text-left pb-2 font-medium">Phone</th>
                    <th className="text-left pb-2 font-medium">Status</th>
                    <th className="text-left pb-2 font-medium">Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {activeCalls.map((call) => (
                    <tr key={call.callLogId} className="border-b border-border/50 hover:bg-secondary/40 transition-colors">
                      <td className="py-2.5 font-mono text-xs">{call.phone ?? '—'}</td>
                      <td className="py-2.5">
                        <span className={cn('text-xs font-medium', STATUS_MAP[call.status]?.color ?? 'text-muted-foreground')}>
                          {STATUS_MAP[call.status]?.label ?? call.status}
                        </span>
                      </td>
                      <td className="py-2.5 font-mono text-xs text-muted-foreground">
                        <CallTimer startedAt={call.startedAt} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        {/* Event feed */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Event Feed</CardTitle>
          </CardHeader>
          <Separator />
          <CardContent className="pt-3">
            <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
              {recentEvents.length === 0 ? (
                <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
                  Waiting for events...
                </div>
              ) : (
                recentEvents.map((event, i) => (
                  <div key={`${event.callLogId}-${i}`} className="flex items-center gap-3 rounded-md bg-secondary/50 px-3 py-2 text-xs">
                    <span className={cn('font-mono font-semibold w-16 shrink-0', EVENT_COLORS[event.type] ?? 'text-muted-foreground')}>
                      {event.type.split(':')[1]?.toUpperCase()}
                    </span>
                    <span className="flex-1 font-mono text-muted-foreground truncate">
                      {event.phone ?? event.callLogId.slice(-8)}
                      {event.digit ? ` [${event.digit}]` : ''}
                      {event.amdResult ? ` (${event.amdResult})` : ''}
                    </span>
                    <span className="shrink-0 text-muted-foreground">
                      {new Date(event.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function CallTimer({ startedAt }: { startedAt: string }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = new Date(startedAt).getTime();
    const tick = () => setElapsed(Math.floor((Date.now() - start) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  const m = Math.floor(elapsed / 60).toString().padStart(2, '0');
  const s = (elapsed % 60).toString().padStart(2, '0');
  return <>{m}:{s}</>;
}
