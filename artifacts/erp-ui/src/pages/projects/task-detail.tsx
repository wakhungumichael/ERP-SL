/* Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu. */
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/context/use-auth';
import { ERPWorkspacePage } from '@/components/erp/workspace/workspace-page';
import { Badge } from '@/components/ui/badge';
import { apiErrorFromResponse } from '@/lib/api-errors';

function useProjectApi<T>(path: string, token: string | null) {
  return useQuery<T>({ queryKey: ['project-detail', path], enabled: !!token, queryFn: async () => { const r = await fetch(path, { headers: { Authorization: `Token ${token}` } }); if (!r.ok) throw await apiErrorFromResponse(r, 'Task details could not be loaded.'); return r.json() as Promise<T>; } });
}

export default function TaskDetail({ id }: { id: string }) {
  const { token } = useAuth();
  const task = useProjectApi<any>(`/api/projects/tasks/${id}/`, token);
  const updates = useProjectApi<any[]>(`/api/projects/tasks/${id}/updates/`, token);
  const followUps = useProjectApi<any[]>(`/api/projects/tasks/${id}/follow-ups/`, token);
  const record = task.data;
  return <ERPWorkspacePage title={record ? `${record.number} - ${record.title}` : 'Task'} description="Assignment, progress updates, and follow-up history for this task.">
    {!record ? <div className="rounded-lg border bg-card p-8 text-sm text-muted-foreground">Loading task details...</div> : <div className="grid gap-5 lg:grid-cols-3"><section className="rounded-lg border bg-card p-5 lg:col-span-2"><h2 className="font-semibold">Task Assignment</h2><p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">{record.description || 'No task description provided.'}</p><dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-muted-foreground">Assigned to</dt><dd className="font-medium">{record.assignee_name || 'Unassigned'}</dd></div><div><dt className="text-muted-foreground">Due date</dt><dd className="font-medium">{record.due_date || 'Not set'}</dd></div><div><dt className="text-muted-foreground">Project</dt><dd className="font-medium">{record.project_name || 'Standalone task'}</dd></div><div><dt className="text-muted-foreground">Workflow</dt><dd className="font-medium">{record.workflow_stage || 'Not submitted'}</dd></div></dl></section><aside className="rounded-lg border bg-card p-5"><h2 className="font-semibold">Current state</h2><Badge className="mt-3" variant="outline">{String(record.status).replaceAll('_', ' ')}</Badge><div className="mt-5 text-3xl font-bold">{record.progress_percentage}%</div><div className="mt-2 h-2 overflow-hidden rounded bg-muted"><div className="h-full bg-[#C4B13B]" style={{ width: `${record.progress_percentage}%` }} /></div></aside><section className="rounded-lg border bg-card p-5 lg:col-span-2"><h2 className="font-semibold">Progress Updates</h2><div className="mt-4 space-y-3">{(updates.data ?? []).map((update) => <div className="rounded border p-3 text-sm" key={update.id}><div className="font-medium">{update.progress_percentage}% progress</div><p className="mt-1 text-muted-foreground">{update.update_description}</p></div>)}{!updates.data?.length && <p className="text-sm text-muted-foreground">No progress updates yet.</p>}</div></section><section className="rounded-lg border bg-card p-5"><h2 className="font-semibold">Follow-ups</h2><div className="mt-4 space-y-3">{(followUps.data ?? []).map((item) => <div className="text-sm" key={item.id}><div className="font-medium">{item.follow_up_date}</div><div className="text-muted-foreground">{item.status}</div></div>)}{!followUps.data?.length && <p className="text-sm text-muted-foreground">No follow-ups scheduled.</p>}</div></section></div>}
  </ERPWorkspacePage>;
}
