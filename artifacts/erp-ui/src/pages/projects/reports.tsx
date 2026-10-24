/* Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu. */
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/context/use-auth';
import { ERPWorkspacePage } from '@/components/erp/workspace/workspace-page';
import { apiErrorFromResponse } from '@/lib/api-errors';

type Report = { summary: Record<string, number>; tasks_by_status: Array<{ status: string; count: number }>; tasks_by_priority: Array<{ priority: string; count: number }>; workload: Array<{ assignee: string | null; name: string | null; count: number }> };
const label = (value: string) => value.replaceAll('_', ' ');
function BarList({ title, rows }: { title: string; rows: Array<{ label: string; count: number }> }) { const max = Math.max(...rows.map((row) => row.count), 1); return <section className="rounded-lg border bg-card p-5"><h2 className="font-semibold">{title}</h2><div className="mt-4 space-y-3">{rows.map((row) => <div key={row.label}><div className="flex justify-between text-sm"><span className="capitalize">{label(row.label)}</span><span className="font-medium">{row.count}</span></div><div className="mt-1 h-2 overflow-hidden rounded bg-muted"><div className="h-full bg-[#C4B13B]" style={{ width: `${(row.count / max) * 100}%` }} /></div></div>)}{!rows.length && <p className="text-sm text-muted-foreground">No data available.</p>}</div></section>; }

export default function ProjectsReports() {
  const { token } = useAuth();
  const report = useQuery<Report>({ queryKey: ['projects-reports'], enabled: !!token, queryFn: async () => { const response = await fetch('/api/projects/reports/', { headers: { Authorization: `Token ${token}` } }); if (!response.ok) throw await apiErrorFromResponse(response, 'Projects report could not be loaded.'); return response.json(); } });
  const data = report.data;
  return <ERPWorkspacePage title="Projects & Tasks Reports" description="Active-branch delivery health, task distribution, and assigned workload."><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{[['Projects', data?.summary.projects], ['Active projects', data?.summary.active_projects], ['Open tasks', data?.summary.open_tasks], ['Overdue tasks', data?.summary.overdue_tasks]].map(([title, count]) => <div className="rounded-lg border bg-card p-5" key={String(title)}><div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</div><div className="mt-3 text-3xl font-bold">{count ?? 0}</div></div>)}</div><div className="mt-5 grid gap-5 lg:grid-cols-2"><BarList title="Tasks by Status" rows={(data?.tasks_by_status ?? []).map((row) => ({ label: row.status, count: row.count }))} /><BarList title="Tasks by Priority" rows={(data?.tasks_by_priority ?? []).map((row) => ({ label: row.priority, count: row.count }))} /><BarList title="Open Workload by Assignee" rows={(data?.workload ?? []).map((row) => ({ label: row.name || 'Unassigned', count: row.count }))} /></div></ERPWorkspacePage>;
}
