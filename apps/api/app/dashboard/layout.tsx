'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  LayoutDashboard, BarChart3, PhoneCall, Users, UserCog,
  GitBranch, ShieldOff, Zap, CheckCircle2, AlertCircle, AlertTriangle,
  Radio, Link2, Server, Music, PhoneOff, ArrowDownLeft,
  Layers, Map, Mic, Settings2, LogOut, Menu, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Separator } from '@/components/ui/separator';
import { useAuth } from '@/lib/auth/AuthContext';

const navItems = [
  {
    section: 'Overview',
    items: [
      { href: '/dashboard',             label: 'Dashboard',   icon: LayoutDashboard },
      { href: '/dashboard/reports',     label: 'Reports',     icon: BarChart3 },
      { href: '/dashboard/reports/cdr', label: 'Call Logs',   icon: PhoneCall },
    ],
  },
  {
    section: 'Dialing',
    items: [
      { href: '/dashboard/campaigns', label: 'Campaigns', icon: PhoneCall },
      { href: '/dashboard/contacts',  label: 'Contacts',  icon: Users },
    ],
  },
  {
    section: 'Configuration',
    items: [
      { href: '/dashboard/agents',      label: 'Agents',      icon: UserCog },
      { href: '/dashboard/ivr-builder', label: 'IVR Builder', icon: GitBranch },
      { href: '/dashboard/dnc',         label: 'DNC List',    icon: ShieldOff },
    ],
  },
  {
    section: 'Asterisk',
    items: [
      { href: '/dashboard/asterisk',              label: 'Connection Hub',  icon: Radio },
      { href: '/dashboard/asterisk/trunks',        label: 'SIP Trunks',      icon: Link2 },
      { href: '/dashboard/asterisk/endpoints',     label: 'Extensions',      icon: Server },
      { href: '/dashboard/asterisk/inbound',       label: 'Inbound Routes',  icon: ArrowDownLeft },
      { href: '/dashboard/asterisk/audio',         label: 'Audio Library',   icon: Music },
      { href: '/dashboard/asterisk/queues',        label: 'Call Queues',     icon: Layers },
      { href: '/dashboard/asterisk/channels',      label: 'Live Channels',   icon: PhoneOff },
      { href: '/dashboard/asterisk/recordings',    label: 'Recordings',      icon: Mic },
      { href: '/dashboard/asterisk/dialplan',      label: 'Dialplan',        icon: Map },
      { href: '/dashboard/asterisk/system',        label: 'System Info',     icon: Settings2 },
    ],
  },
];

interface HealthCheck {
  status: 'ok' | 'error' | 'degraded';
  checks: Record<string, { status: 'ok' | 'error' | 'degraded'; detail?: string }>;
}

const CHECK_LABELS: Record<string, string> = { mongodb: 'MongoDB', redis: 'Redis', queue: 'Queue' };

function StatusIcon({ status }: { status: HealthCheck['status'] | undefined }) {
  if (!status) return <div className="h-2 w-2 rounded-full bg-muted-foreground animate-pulse" />;
  if (status === 'ok')      return <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0" />;
  if (status === 'error')   return <AlertCircle  className="h-3.5 w-3.5 text-destructive shrink-0" />;
  return                           <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0" />;
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [health, setHealth] = useState<HealthCheck | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const { user, logout } = useAuth();

  useEffect(() => {
    const fetchHealth = () =>
      fetch('/api/health')
        .then((r) => r.json() as Promise<HealthCheck>)
        .then(setHealth)
        .catch(() => setHealth(null));

    void fetchHealth();
    const t = setInterval(fetchHealth, 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  return (
    <div className="flex min-h-dvh bg-background">
      {mobileNavOpen && (
        <button
          type="button"
          aria-label="Close navigation overlay"
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setMobileNavOpen(false)}
        />
      )}
      {/* ── Sidebar ── */}
      <aside className={cn(
        'fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] shrink-0 flex-col overflow-y-auto border-r border-sidebar-border bg-sidebar transition-transform md:sticky md:top-0 md:z-auto md:h-dvh md:w-64 md:max-w-none',
        mobileNavOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
      )}>
        {/* Logo */}
        <div className="px-6 py-5">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/20">
              <Zap className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="text-sm font-bold text-foreground leading-none">DialerOS</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">Predictive Dialer</p>
            </div>
          </div>
        </div>

        <Separator className="bg-sidebar-border" />

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-6">
          {navItems.map((section) => (
            <div key={section.section}>
              <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                {section.section}
              </p>
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const Icon = item.icon;
                  const active = pathname === item.href;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                        active
                          ? 'bg-primary/15 text-primary'
                          : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                      )}
                    >
                      <Icon className={cn('h-4 w-4 shrink-0', active ? 'text-primary' : 'text-muted-foreground')} />
                      {item.label}
                      {active && (
                        <div className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Health widget */}
        <div className="px-3 pb-4">
          <Separator className="mb-3 bg-sidebar-border" />
          <div className={cn(
            'rounded-lg border p-3 text-xs',
            health?.status === 'error'   && 'border-destructive/30 bg-destructive/5',
            health?.status === 'ok'      && 'border-success/25 bg-success/5',
            health?.status === 'degraded'&& 'border-warning/30 bg-warning/5',
            !health                      && 'border-border bg-secondary/40',
          )}>
            <div className="flex items-center gap-2 mb-2">
              <StatusIcon status={health?.status} />
              <span className={cn(
                'font-semibold',
                health?.status === 'ok'       && 'text-success',
                health?.status === 'error'    && 'text-destructive',
                health?.status === 'degraded' && 'text-warning',
                !health                       && 'text-muted-foreground',
              )}>
                {!health ? 'Checking...' :
                  health.status === 'ok' ? 'All Systems OK' :
                  health.status === 'error' ? 'Service Error' : 'Degraded'}
              </span>
            </div>
            {health && (
              <div className="space-y-1">
                {Object.entries(health.checks).map(([key, check]) => (
                  <div key={key} className="flex items-center justify-between">
                    <span className="text-muted-foreground">{CHECK_LABELS[key] ?? key}</span>
                    <span className={cn(
                      'font-medium uppercase text-[10px]',
                      check.status === 'ok' && 'text-success',
                      check.status === 'error' && 'text-destructive',
                      check.status === 'degraded' && 'text-warning',
                    )}>
                      {check.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        {/* User + logout footer */}
        <div className="px-3 pb-3">
          <Separator className="mb-3 bg-sidebar-border" />
          <div className="flex items-center gap-2.5 rounded-lg px-3 py-2 bg-sidebar-accent/40">
            {/* Avatar */}
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/20 text-primary font-semibold text-xs uppercase">
              {user?.name?.[0] ?? user?.email?.[0] ?? 'U'}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-foreground leading-none">{user?.name ?? 'Admin'}</p>
              <p className="truncate text-[10px] text-muted-foreground mt-0.5">{user?.role}</p>
            </div>
            <button
              onClick={logout}
              id="sidebar-logout"
              title="Sign out"
              className="ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </aside>

      {/* ── Main ── */}
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="sticky top-0 z-30 border-b border-border/60 bg-background/90 px-4 py-3 backdrop-blur md:hidden">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setMobileNavOpen((open) => !open)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card text-foreground"
              aria-label="Toggle navigation"
            >
              {mobileNavOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
            <p className="text-sm font-semibold">DialerOS</p>
            <button
              onClick={logout}
              title="Sign out"
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card text-muted-foreground hover:text-destructive"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 sm:py-6 lg:px-8 lg:py-8 animate-fade-in">
          {children}
        </div>
      </main>
    </div>
  );
}
