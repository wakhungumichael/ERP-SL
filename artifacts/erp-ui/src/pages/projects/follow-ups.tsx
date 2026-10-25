/* Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { useAuth } from '@/context/use-auth';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ERPWorkspacePage } from '@/components/erp/workspace/workspace-page';
import { useToast } from '@/hooks/use-toast';
import { apiErrorFromResponse } from '@/lib/api-errors';

type FollowUp = { id: number; task_id: number; task_number: string; task_title: string; follow_up_date: string; notes: string; status: string; owner: string };

function formatDate(value: string) { return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value)); }

export default function ProjectFollowUps() {
  const { token } = useAuth();
  const { toast } = useToast();
  const client = useQueryClient();
  const followUps = useQuery<FollowUp[]>({
    queryKey: ['projects-follow-ups'],
    enabled: !!token,
    queryFn: async () => {
      const response = await fetch('/api/projects/follow-ups/', { headers: { Authorization: `Token ${token}` } });
      if (!response.ok) throw await apiErrorFromResponse(response, 'Follow-ups could not be loaded.');
      return response.json();
    },
  });
  const complete = useMutation({
    mutationFn: async (followUp: FollowUp) => {
      const response = await fetch(`/api/projects/tasks/${followUp.task_id}/follow-ups/${followUp.id}/complete/`, { method: 'POST', headers: { Authorization: `Token ${token}` } });
      if (!response.ok) throw await apiErrorFromResponse(response, 'Follow-up could not be completed.');
      return response.json();
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['projects-follow-ups'] });
      toast({ title: 'Follow-up completed' });
    },
    onError: (error: Error) => toast({ title: 'Could not complete follow-up', description: error.message, variant: 'destructive' }),
  });
  const list = followUps.data ?? [];
  const overdue = list.filter((item) => item.status === 'overdue').length;

  return <ERPWorkspacePage title="Project Follow-ups" description="Scheduled actions across tasks in your active branch.">
    <div className="grid gap-4 md:grid-cols-3">
      <Metric label="Open follow-ups" value={list.filter((item) => !['completed', 'cancelled'].includes(item.status)).length} />
      <Metric label="Overdue" value={overdue} accent="text-red-600" />
      <Metric label="Completed" value={list.filter((item) => item.status === 'completed').length} />
    </div>
    <div className="mt-5 overflow-x-auto rounded-lg border bg-card">
      <table className="w-full min-w-[760px] text-sm"><thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="px-4 py-3">Due</th><th className="px-4 py-3">Task</th><th className="px-4 py-3">Notes</th><th className="px-4 py-3">Owner</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Action</th></tr></thead><tbody>{list.map((item) => <tr className="border-b last:border-0" key={item.id}><td className="px-4 py-3">{formatDate(item.follow_up_date)}</td><td className="px-4 py-3"><Link href={`/projects/tasks/${item.task_id}`}><span className="cursor-pointer font-medium hover:underline">{item.task_number} - {item.task_title}</span></Link></td><td className="px-4 py-3 text-muted-foreground">{item.notes || '-'}</td><td className="px-4 py-3">{item.owner}</td><td className="px-4 py-3"><Badge variant="outline">{item.status}</Badge></td><td className="px-4 py-3 text-right">{!['completed', 'cancelled'].includes(item.status) ? <Button size="sm" variant="outline" disabled={complete.isPending} onClick={() => complete.mutate(item)}>Complete</Button> : null}</td></tr>)}</tbody></table>
      {!list.length && <div className="p-10 text-center text-sm text-muted-foreground">No follow-ups are scheduled in this branch.</div>}
    </div>
  </ERPWorkspacePage>;
}

function Metric({ label, value, accent = '' }: { label: string; value: number; accent?: string }) {
  return <div className="rounded-lg border bg-card p-5"><div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</div><div className={`mt-3 text-3xl font-bold ${accent}`}>{value}</div></div>;
}
