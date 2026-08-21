import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, CheckCircle2, MessageSquare, Search } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ERPFormDialog } from '@/components/erp/forms/form-dialog';
import { ERPFilterBar } from '@/components/erp/listing/filter-bar';
import { ERPDataTable, type ERPTableColumn } from '@/components/erp/listing/data-table';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/context/use-auth';

type TicketRow = {
  id: number;
  public_id: string;
  subject: string;
  requester_name?: string;
  requester_email: string;
  description?: string;
  priority: string;
  status: string;
  assigned_to_name?: string;
  source_channel?: string;
  timeline?: Array<{
    kind: string;
    author_name?: string;
    author_type?: string;
    summary?: string;
    message?: string;
    direction?: string;
    channel?: string;
    delivery_status?: string;
    payload?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  }>;
};

function authFetch(token: string, path: string, init?: RequestInit) {
  return fetch(path, {
    ...init,
    headers: {
      Authorization: `Token ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
}

export default function TicketingQueue() {
  const { token } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [reply, setReply] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'new' | 'open' | 'pending' | 'resolved' | 'closed'>('all');
  const [priorityFilter, setPriorityFilter] = useState<'all' | 'low' | 'normal' | 'high' | 'urgent'>('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [replyChannel, setReplyChannel] = useState<'portal' | 'email' | 'whatsapp'>('portal');

  const { data, isLoading } = useQuery<TicketRow[]>({
    queryKey: ['ticketing-queue', search, statusFilter, priorityFilter],
    enabled: !!token,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search.trim()) params.set('search', search.trim());
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (priorityFilter !== 'all') params.set('priority', priorityFilter);
      const query = params.toString();
      const res = await authFetch(token!, `/api/ticketing/tickets/${query ? `?${query}` : ''}`);
      if (!res.ok) throw new Error('Failed to load tickets');
      return res.json();
    },
  });

  const tickets = data ?? [];
  const counts = useMemo(() => ({
    total: tickets.length,
    open: tickets.filter((ticket) => ['new', 'open', 'pending'].includes(ticket.status)).length,
    resolved: tickets.filter((ticket) => ticket.status === 'resolved').length,
    urgent: tickets.filter((ticket) => ticket.priority === 'urgent').length,
  }), [tickets]);
  const selectedTicket = useMemo(
    () => tickets.find((ticket) => ticket.id === selectedId) ?? null,
    [selectedId, tickets],
  );

  const availableReplyChannels = useMemo(() => {
    if (!selectedTicket) return ['portal'] as Array<'portal' | 'email' | 'whatsapp'>;
    const channels: Array<'portal' | 'email' | 'whatsapp'> = ['portal', 'email'];
    if (selectedTicket.source_channel === 'whatsapp' || selectedTicket.requester_email?.endsWith('@whatsapp.local')) {
      channels.push('whatsapp');
    }
    return channels;
  }, [selectedTicket]);

  useEffect(() => {
    if (!availableReplyChannels.includes(replyChannel)) {
      setReplyChannel(availableReplyChannels[0]);
    }
  }, [availableReplyChannels, replyChannel]);

  const columns: ERPTableColumn<TicketRow>[] = [
    {
      key: 'ticket',
      label: 'Ticket',
      render: (row) => (
        <div>
          <div className="font-medium">{row.subject}</div>
          <div className="text-xs text-muted-foreground">{row.public_id}</div>
        </div>
      ),
    },
    {
      key: 'requester',
      label: 'Requester',
      render: (row) => (
        <div>
          <div className="text-sm">{row.requester_name || row.requester_email}</div>
          <div className="text-xs text-muted-foreground">{row.requester_email}</div>
        </div>
      ),
    },
    {
      key: 'priority',
      label: 'Priority',
      render: (row) => <Badge>{row.priority}</Badge>,
    },
    {
      key: 'status',
      label: 'Status',
      render: (row) => <Badge variant="outline">{row.status}</Badge>,
    },
    {
      key: 'assignee',
      label: 'Assigned To',
      render: (row) => <span className="text-sm text-muted-foreground">{row.assigned_to_name || 'Unassigned'}</span>,
    },
  ];

  const replyMutation = useMutation({
    mutationFn: async () => {
      if (!selectedTicket) return null;
      const res = await authFetch(token!, `/api/ticketing/tickets/${selectedTicket.id}/reply/`, {
        method: 'POST',
        body: JSON.stringify({ message: reply, is_public: true, reply_channel: replyChannel }),
      });
      if (!res.ok) throw new Error('Failed to send reply');
      return res.json();
    },
    onSuccess: () => {
      setReply('');
      setReplyChannel('portal');
      qc.invalidateQueries({ queryKey: ['ticketing-queue'] });
    },
  });

  const statusMutation = useMutation({
    mutationFn: async (nextStatus: string) => {
      if (!selectedTicket) return null;
      const res = await authFetch(token!, `/api/ticketing/tickets/${selectedTicket.id}/`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!res.ok) throw new Error('Failed to update ticket');
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ticketing-queue'] }),
  });

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Agent Queue</h1>
          <p className="mt-1 text-sm text-muted-foreground">Work support tickets through the same review flow we use across the ERP.</p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card><CardContent className="pt-4"><div className="text-2xl font-semibold">{counts.total}</div><div className="text-sm text-muted-foreground">Loaded Tickets</div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="text-2xl font-semibold">{counts.open}</div><div className="text-sm text-muted-foreground">Open Queue</div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="text-2xl font-semibold">{counts.resolved}</div><div className="text-sm text-muted-foreground">Resolved</div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="text-2xl font-semibold">{counts.urgent}</div><div className="text-sm text-muted-foreground">Urgent</div></CardContent></Card>
      </div>

      <ERPFilterBar
        searchSlot={(
          <div className="relative w-full">
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search by subject, requester email, or ticket ID" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        )}
        filterSlot={(
          <div className="flex flex-wrap items-center gap-3">
            <Select value={statusFilter} onValueChange={(value: typeof statusFilter) => setStatusFilter(value)}>
              <SelectTrigger className="w-[170px]"><SelectValue placeholder="Ticket Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="new">New</SelectItem>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="resolved">Resolved</SelectItem>
                <SelectItem value="closed">Closed</SelectItem>
              </SelectContent>
            </Select>
            <Select value={priorityFilter} onValueChange={(value: typeof priorityFilter) => setPriorityFilter(value)}>
              <SelectTrigger className="w-[170px]"><SelectValue placeholder="Priority Level" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Priorities</SelectItem>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="normal">Normal</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="urgent">Urgent</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      />

      <Card>
        <CardHeader>
          <CardTitle>Ticket Register</CardTitle>
        </CardHeader>
        <CardContent>
          <ERPDataTable
            columns={columns}
            rows={tickets}
            loading={isLoading}
            loadingLabel="Loading ticket queue…"
            emptyState="No tickets match the current filters."
            onRowClick={(row) => {
              setSelectedId(row.id);
              setDialogOpen(true);
            }}
            rowActions={(row) => (
              <Button variant="ghost" size="sm" onClick={() => { setSelectedId(row.id); setDialogOpen(true); }}>
                <MessageSquare className="h-4 w-4" />
              </Button>
            )}
          />
        </CardContent>
      </Card>

      <ERPFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={selectedTicket ? selectedTicket.subject : 'Ticket Detail'}
        maxWidthClassName="max-w-4xl"
        footer={selectedTicket ? (
          <div className="flex w-full flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => statusMutation.mutate('open')} disabled={statusMutation.isPending || selectedTicket.status === 'open'}>
                <ArrowUpRight className="mr-1 h-4 w-4" />
                Mark Open
              </Button>
              <Button variant="outline" size="sm" onClick={() => statusMutation.mutate('pending')} disabled={statusMutation.isPending || selectedTicket.status === 'pending'}>
                Set Pending
              </Button>
              <Button size="sm" onClick={() => statusMutation.mutate('resolved')} disabled={statusMutation.isPending || selectedTicket.status === 'resolved'}>
                <CheckCircle2 className="mr-1 h-4 w-4" />
                Resolve
              </Button>
              <Button variant="outline" size="sm" onClick={() => statusMutation.mutate('closed')} disabled={statusMutation.isPending || selectedTicket.status === 'closed'}>
                Close
              </Button>
            </div>
            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Close</Button>
              <Button onClick={() => replyMutation.mutate()} disabled={!reply.trim() || replyMutation.isPending}>
                {replyMutation.isPending ? 'Sending…' : 'Send Reply'}
              </Button>
            </div>
          </div>
        ) : undefined}
      >
        {!selectedTicket ? (
          <div className="text-sm text-muted-foreground">Choose a ticket from the register to inspect its history.</div>
        ) : (
          <div className="space-y-5">
            <div className="flex flex-wrap gap-2">
              <Badge>{selectedTicket.priority}</Badge>
              <Badge variant="outline">{selectedTicket.status}</Badge>
              <Badge variant="secondary">{selectedTicket.source_channel || 'portal'}</Badge>
              {selectedTicket.assigned_to_name ? <Badge variant="secondary">{selectedTicket.assigned_to_name}</Badge> : null}
            </div>
            <div className="rounded-lg border p-4 text-sm">
              <div className="font-medium">{selectedTicket.requester_name || selectedTicket.requester_email}</div>
              <div className="mt-1 text-muted-foreground">{selectedTicket.description || 'No description supplied.'}</div>
            </div>
            <div className="space-y-3">
              {(selectedTicket.timeline ?? []).map((item, index) => (
                <div key={`${item.kind}-${index}`} className="rounded-lg border p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="font-medium">{item.kind === 'message' ? (item.author_name || item.author_type) : item.summary}</div>
                    {item.kind === 'message' ? <Badge variant="outline">{item.channel || 'portal'}</Badge> : null}
                    {item.kind === 'message' && item.direction ? <Badge variant="secondary">{item.direction}</Badge> : null}
                    {item.kind === 'message' && item.delivery_status ? <Badge>{item.delivery_status}</Badge> : null}
                  </div>
                  <div className="mt-1 text-muted-foreground">
                    {item.kind === 'message' ? item.message : JSON.stringify(item.payload ?? {})}
                  </div>
                </div>
              ))}
            </div>
            <div className="space-y-2">
              <div className="text-sm font-medium">Public Reply</div>
              <div className="grid gap-3 md:grid-cols-[220px_1fr]">
                <div className="space-y-2">
                  <div className="text-xs font-medium text-muted-foreground">Send through</div>
                  <Select value={replyChannel} onValueChange={(value: 'portal' | 'email' | 'whatsapp') => setReplyChannel(value)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {availableReplyChannels.map((channel) => (
                        <SelectItem key={channel} value={channel}>{channel}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Textarea value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Write a response to the requester" rows={6} />
            </div>
          </div>
        )}
      </ERPFormDialog>
    </div>
  );
}
