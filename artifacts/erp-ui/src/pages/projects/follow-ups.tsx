/* Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu. */
import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
import { useAuth } from '@/context/use-auth';
import { Badge } from '@/components/ui/badge';
import { ERPWorkspacePage } from '@/components/erp/workspace/workspace-page';
import { apiErrorFromResponse } from '@/lib/api-errors';

type FollowUp = { id: number; task_id: number; task_number: string; task_title: string; follow_up_date: string; notes: string; status: string; owner: string };
function formatDate(value: string) { return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value)); }

export default function ProjectFollowUps() {
  const { token } = useAuth();
  const followUps = useQuery<FollowUp[]>({ queryKey: ['projects-follow-ups'], enabled: !!token, queryFn: async () => { const response = await fetch('/api/projects/follow-ups/', { headers: { Authorization: `Token ${token}` } }); if (!response.ok) throw await apiErrorFromResponse(response, 'Follow-ups could not be loaded.'); return response.json(); } });
  const list = followUps.data ?? []; const overdue = list.filter((item) => item.status === 'overdue').length;
  return <ERPWorkspacePage title="Project Follow-ups" description="Scheduled actions across tasks in your active branch."><div className="grid gap-4 md:grid-cols-3"><div className="rounded-lg border bg-card p-5"><div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Open follow-ups</div><div className="mt-3 text-3xl font-bold">{list.filter((item) => !['completed', 'cancelled'].includes(item.status)).length}</div></div><div className="rounded-lg border bg-card p-5"><div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Overdue</div><div className="mt-3 text-3xl font-bold text-red-600">{overdue}</div></div><div className="rounded-lg border bg-card p-5"><div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Completed</div><div className="mt-3 text-3xl font-bold">{list.filter((item) => item.status === 'completed').length}</div></div></div><div className="mt-5 overflow-hidden rounded-lg border bg-card"><table className="w-full text-sm"><thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="px-4 py-3">Due</th><th className="px-4 py-3">Task</th><th className="px-4 py-3">Notes</th><th className="px-4 py-3">Owner</th><th className="px-4 py-3">Status</th></tr></thead><tbody>{list.map((item) => <tr className="border-b last:border-0" key={item.id}><td className="px-4 py-3">{formatDate(item.follow_up_date)}</td><td className="px-4 py-3"><Link href={`/projects/tasks/${item.task_id}`}><span className="cursor-pointer font-medium hover:underline">{item.task_number} - {item.task_title}</span></Link></td><td className="px-4 py-3 text-muted-foreground">{item.notes || '—'}</td><td className="px-4 py-3">{item.owner}</td><td className="px-4 py-3"><Badge variant="outline">{item.status}</Badge></td></tr>)}</tbody></table>{!list.length && <div className="p-10 text-center text-sm text-muted-foreground">No follow-ups are scheduled in this branch.</div>}</div></ERPWorkspacePage>;
}
