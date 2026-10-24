/* Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu. */
import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
import { useAuth } from '@/context/use-auth';
import { Badge } from '@/components/ui/badge';
import { ERPWorkspacePage } from '@/components/erp/workspace/workspace-page';
import { apiErrorFromResponse } from '@/lib/api-errors';

type Task = { id: number; number: string; title: string; project_name: string; assignee_name: string; due_date: string | null; priority: string; progress_percentage: number; status: string; workflow_stage: string };
type Page = { results: Task[] };
const columns = [
  ['todo', 'To Do', 'border-slate-200 bg-slate-50'],
  ['in_progress', 'In Progress', 'border-blue-200 bg-blue-50'],
  ['in_review', 'In Review', 'border-amber-200 bg-amber-50'],
  ['blocked', 'Blocked', 'border-red-200 bg-red-50'],
  ['completed', 'Completed', 'border-emerald-200 bg-emerald-50'],
] as const;

export default function ProjectKanban() {
  const { token } = useAuth();
  const tasks = useQuery<Page>({ queryKey: ['projects-kanban'], enabled: !!token, queryFn: async () => { const response = await fetch('/api/projects/tasks/?page_size=100', { headers: { Authorization: `Token ${token}` } }); if (!response.ok) throw await apiErrorFromResponse(response, 'Task board could not be loaded.'); return response.json(); } });
  const list = tasks.data?.results ?? [];
  return <ERPWorkspacePage title="Task Board" description="A branch-scoped view of work. Use the task record to update progress or forward it through approval.">
    <div className="grid min-w-max grid-cols-5 gap-4 overflow-x-auto pb-3">{columns.map(([status, title, tone]) => { const columnTasks = list.filter((task) => task.status === status); return <section className={`w-72 rounded-lg border p-3 ${tone}`} key={status}><div className="flex items-center justify-between"><h2 className="font-semibold">{title}</h2><Badge variant="outline">{columnTasks.length}</Badge></div><div className="mt-3 space-y-3">{columnTasks.map((task) => <Link href={`/projects/tasks/${task.id}`} key={task.id}><article className="cursor-pointer rounded-md border bg-card p-3 shadow-sm transition hover:-translate-y-0.5 hover:shadow"><div className="flex items-start justify-between gap-2"><span className="font-mono text-xs text-muted-foreground">{task.number}</span><Badge variant="outline">{task.priority}</Badge></div><h3 className="mt-2 font-medium">{task.title}</h3><p className="mt-1 truncate text-xs text-muted-foreground">{task.project_name || 'Standalone task'}</p><div className="mt-3 h-1.5 overflow-hidden rounded bg-muted"><div className="h-full bg-[#C4B13B]" style={{ width: `${task.progress_percentage}%` }} /></div><div className="mt-2 flex justify-between text-xs text-muted-foreground"><span>{task.assignee_name || 'Unassigned'}</span><span>{task.progress_percentage}%</span></div>{task.workflow_stage ? <p className="mt-2 text-xs text-muted-foreground">Approval: {task.workflow_stage}</p> : null}</article></Link>)}{!columnTasks.length && <p className="rounded border border-dashed bg-card/50 p-4 text-center text-xs text-muted-foreground">No tasks</p>}</div></section>; })}</div>
  </ERPWorkspacePage>;
}
