'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Users, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface Contact {
  _id: string; phone: string; firstName: string; lastName: string;
  status: string; retryCount: number; nextRetryAt?: string; createdAt: string;
}
interface Campaign { _id: string; name: string; }

const STATUS_COLORS: Record<string, string> = {
  pending: 'text-muted-foreground', dialing: 'text-primary', answered: 'text-success',
  machine: 'text-warning', busy: 'text-warning', no_answer: 'text-muted-foreground',
  failed: 'text-destructive', dnc: 'text-destructive', completed: 'text-success', retry_scheduled: 'text-primary',
};

const STATUSES = ['pending','dialing','answered','machine','busy','no_answer','failed','dnc','completed','retry_scheduled'];

export default function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ campaignId: '', status: '', q: '' });
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const LIMIT = 50;

  const token = () => localStorage.getItem('dialer_access_token') ?? '';

  useEffect(() => {
    fetch('/api/campaigns', { headers: { Authorization: `Bearer ${token()}` } })
      .then((r) => r.json() as Promise<{ data: Campaign[] }>)
      .then((d) => setCampaigns(d.data ?? []))
      .catch(console.error);
  }, []);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filter.campaignId) params.set('campaignId', filter.campaignId);
    if (filter.status) params.set('status', filter.status);
    if (filter.q) params.set('q', filter.q);
    params.set('page', String(page));
    params.set('limit', String(LIMIT));
    fetch(`/api/contacts?${params}`, { headers: { Authorization: `Bearer ${token()}` } })
      .then((r) => r.json() as Promise<{ data: Contact[]; total: number }>)
      .then((d) => { setContacts(d.data ?? []); setTotal(d.total ?? 0); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [filter, page]);

  const totalPages = Math.ceil(total / LIMIT);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Contacts</h1>
        <p className="text-sm text-muted-foreground mt-1">{total.toLocaleString()} total contacts</p>
      </div>

      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
            <div className="w-full flex-1 space-y-1.5 sm:min-w-48">
              <Label>Search name / phone</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input className="pl-8" placeholder="Search..." value={filter.q}
                  onChange={(e) => { setFilter({ ...filter, q: e.target.value }); setPage(1); }} />
              </div>
            </div>
            <div className="w-full space-y-1.5 sm:w-auto sm:min-w-44">
              <Label>Campaign</Label>
              <Select value={filter.campaignId} onValueChange={(v) => { setFilter({ ...filter, campaignId: v === 'all' ? '' : v }); setPage(1); }}>
                <SelectTrigger><SelectValue placeholder="All campaigns" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All campaigns</SelectItem>
                  {campaigns.map((c) => <SelectItem key={c._id} value={c._id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="w-full space-y-1.5 sm:w-auto sm:min-w-44">
              <Label>Status</Label>
              <Select value={filter.status} onValueChange={(v) => { setFilter({ ...filter, status: v === 'all' ? '' : v }); setPage(1); }}>
                <SelectTrigger><SelectValue placeholder="All statuses" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-0 px-0">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">Loading...</div>
          ) : contacts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2">
              <Users className="h-10 w-10 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">No contacts match your filters</p>
            </div>
          ) : (
            <>
              <Table className="min-w-215">
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead><TableHead>Phone</TableHead><TableHead>Status</TableHead>
                    <TableHead>Retries</TableHead><TableHead>Next Retry</TableHead><TableHead>Added</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {contacts.map((c) => (
                    <TableRow key={c._id}>
                      <TableCell className="font-medium">{c.firstName} {c.lastName}</TableCell>
                      <TableCell className="font-mono text-xs">{c.phone}</TableCell>
                      <TableCell>
                        <span className={cn('text-xs capitalize', STATUS_COLORS[c.status] ?? 'text-foreground')}>
                          ● {c.status.replace(/_/g, ' ')}
                        </span>
                      </TableCell>
                      <TableCell className={cn('font-mono text-xs', c.retryCount > 0 && 'text-warning')}>{c.retryCount}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{c.nextRetryAt ? new Date(c.nextRetryAt).toLocaleString() : '—'}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{new Date(c.createdAt).toLocaleDateString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-3 py-4 border-t border-border">
                  <Button variant="secondary" size="sm" disabled={page === 1} onClick={() => setPage(page - 1)}>← Prev</Button>
                  <span className="text-sm text-muted-foreground">Page {page} of {totalPages}</span>
                  <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next →</Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
