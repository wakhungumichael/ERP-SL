import { useState } from 'react';
import { Bell, Check, Clock3, ExternalLink, RotateCcw, X } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { useAuth } from '@/context/use-auth';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { apiErrorFromResponse, formatApiError } from '@/lib/api-errors';

type Status = 'pending' | 'deferred' | 'approved' | 'rejected' | 'completed';
const labels: Record<Status, string> = { pending: 'Awaiting me', deferred: 'Deferred', approved: 'Approved', rejected: 'Rejected', completed: 'Completed' };

export default function WorkflowApprovals() {
  const { token } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<Status>('pending');
  const [acting, setActing] = useState<number | null>(null);
  const query = useQuery({
    queryKey: ['workflow-approvals', status, token],
    enabled: !!token,
    queryFn: async () => {
      const response = await fetch(`/api/platform/workflows/inbox/?status=${status}&limit=100`, { headers: { Authorization: `Token ${token}` } });
      if (!response.ok) throw await apiErrorFromResponse(response, 'Unable to load workflow approvals.');
      const body = await response.json();
      return body?.data ?? body;
    },
  });
  const items = query.data?.results ?? [];
  const act = async (id: number, decision: 'approve' | 'reject' | 'defer' | 'resume') => {
    const reason = decision === 'defer' ? window.prompt('Why are you deferring this approval?') : '';
    if (decision === 'defer' && reason === null) return;
    setActing(id);
    try {
      const response = await fetch(`/api/platform/workflows/inbox/${id}/action/`, {
        method: 'POST', headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, reason }),
      });
      if (!response.ok) throw await apiErrorFromResponse(response, 'The workflow action could not be completed.');
      const body = await response.json();
      toast({ title: body?.message || 'Workflow updated' });
      queryClient.invalidateQueries({ queryKey: ['workflow-approvals'] });
      queryClient.invalidateQueries({ queryKey: ['workflow-notifications'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-widget-inbox'] });
    } catch (error) { toast({ title: 'Workflow action failed', description: formatApiError(error), variant: 'destructive' }); }
    finally { setActing(null); }
  };
  return <div className="mx-auto w-full max-w-6xl space-y-6 p-4 md:p-6">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-primary"><Bell className="h-4 w-4" /> Workflow runtime</div><h1 className="text-3xl font-semibold tracking-tight">Approvals & Notifications</h1><p className="mt-1 text-sm text-muted-foreground">Act on records assigned to your role, defer work that needs follow-up, and review completed decisions.</p></div><Link href="/platform/workflows"><Button variant="outline">Configure workflows</Button></Link></div>
    <Tabs value={status} onValueChange={(value) => setStatus(value as Status)}><TabsList className="h-auto flex-wrap justify-start gap-1 bg-muted/60 p-1">{(Object.keys(labels) as Status[]).map((value) => <TabsTrigger key={value} value={value}>{labels[value]}</TabsTrigger>)}</TabsList></Tabs>
    <div className="grid gap-4 sm:grid-cols-3"><Card><CardHeader className="pb-2"><CardDescription>Items shown</CardDescription><CardTitle className="text-3xl">{items.length}</CardTitle></CardHeader></Card><Card><CardHeader className="pb-2"><CardDescription>Current queue</CardDescription><CardTitle className="text-lg">{labels[status]}</CardTitle></CardHeader></Card><Card><CardHeader className="pb-2"><CardDescription>Notifications</CardDescription><CardTitle className="text-lg">Role-based and in-app</CardTitle></CardHeader></Card></div>
    <Card><CardContent className="p-0">{query.isLoading ? <div className="p-8 text-sm text-muted-foreground">Loading approval queue...</div> : items.length === 0 ? <div className="p-10 text-center text-sm text-muted-foreground">No {labels[status].toLowerCase()} workflow items.</div> : <div className="divide-y">{items.map((item: any) => <div key={item.id} className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">{item.title}</h2><Badge variant="outline">{item.reference || item.entity_type}</Badge><Badge variant={item.status === 'pending' ? 'default' : 'secondary'}>{item.status}</Badge></div><p className="mt-2 text-sm text-muted-foreground">{item.detail || 'No additional details supplied.'}</p><p className="mt-2 text-xs text-muted-foreground">{item.workflow_name || 'Workflow'} · {item.assigned_group_name || item.assigned_user_name || 'Assigned approver'}{item.defer_reason ? ` · Deferred: ${item.defer_reason}` : ''}</p></div><div className="flex shrink-0 flex-wrap items-center gap-2">{item.route_path && <Link href={item.route_path}><Button size="sm" variant="outline"><ExternalLink className="mr-1 h-3.5 w-3.5" />Open</Button></Link>}{status === 'pending' && <><Button size="sm" onClick={() => act(item.id, 'approve')} disabled={acting === item.id}><Check className="mr-1 h-3.5 w-3.5" />Approve</Button><Button size="sm" variant="outline" onClick={() => act(item.id, 'defer')} disabled={acting === item.id}><Clock3 className="mr-1 h-3.5 w-3.5" />Defer</Button><Button size="sm" variant="outline" className="text-destructive" onClick={() => act(item.id, 'reject')} disabled={acting === item.id}><X className="mr-1 h-3.5 w-3.5" />Reject</Button></>}{status === 'deferred' && <Button size="sm" onClick={() => act(item.id, 'resume')} disabled={acting === item.id}><RotateCcw className="mr-1 h-3.5 w-3.5" />Resume</Button>}</div></div>)}</div>}</CardContent></Card>
  </div>;
}
