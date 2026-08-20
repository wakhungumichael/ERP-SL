import { useQuery } from '@tanstack/react-query';
import { AlertCircle, Inbox, ShieldCheck, Ticket, Zap } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/context/use-auth';

export default function TicketingOverview() {
  const { token } = useAuth();
  const { data, isLoading, error } = useQuery({
    queryKey: ['ticketing-dashboard'],
    enabled: !!token,
    queryFn: async () => {
      const res = await fetch('/api/ticketing/dashboard/', {
        headers: { Authorization: `Token ${token}` },
      });
      if (!res.ok) throw new Error('Failed to load ticketing dashboard');
      return res.json();
    },
  });

  const counts = data?.counts ?? {};
  const cards = [
    { label: 'Open Queue', value: counts.open ?? 0, icon: Inbox },
    { label: 'Resolved', value: counts.resolved ?? 0, icon: ShieldCheck },
    { label: 'Unassigned', value: counts.unassigned ?? 0, icon: AlertCircle },
    { label: 'High Priority', value: counts.high_priority ?? 0, icon: Zap },
  ];

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Ticketing Overview</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Track inbound support demand, assignment health, and public portal activity per tenant.
          </p>
        </div>
        <Badge variant="secondary">{counts.total ?? 0} total tickets</Badge>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading ticketing metrics…</div>
      ) : error ? (
        <Card><CardContent className="p-6 text-sm text-destructive">Ticketing data could not be loaded.</CardContent></Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {cards.map((card) => (
              <Card key={card.label}>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">{card.label}</CardTitle>
                  <card.icon className="h-4 w-4 text-primary" />
                </CardHeader>
                <CardContent><div className="text-2xl font-semibold">{card.value}</div></CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><Ticket className="h-4 w-4" /> Recent Tickets</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {(data?.recent ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No ticket activity yet.</p>
              ) : (
                (data.recent ?? []).map((ticket: any) => (
                  <div key={ticket.public_id} className="rounded-lg border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="font-medium">{ticket.subject}</div>
                        <div className="text-xs text-muted-foreground">{ticket.public_id} • {ticket.requester_email}</div>
                      </div>
                      <div className="flex gap-2">
                        <Badge variant="outline">{ticket.status}</Badge>
                        <Badge>{ticket.priority}</Badge>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

