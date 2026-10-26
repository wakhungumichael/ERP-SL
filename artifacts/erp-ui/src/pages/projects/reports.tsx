/* Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu. */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ListingPagination } from "@/components/erp/listing/pagination";
import { downloadDocumentPdf } from "@/lib/document-download";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/context/use-auth";
import { ERPWorkspacePage } from "@/components/erp/workspace/workspace-page";
import { apiErrorFromResponse } from "@/lib/api-errors";

type Report = {
  columns: string[];
  rows: Array<Array<string | number | null>>;
  count: number;
  can_export: boolean;
  summary: Record<string, number>;
  tasks_by_status: Array<{ status: string; count: number }>;
  tasks_by_priority: Array<{ priority: string; count: number }>;
  project_progress: Array<{
    code: string;
    name: string;
    progress_percentage: number;
    status: string;
  }>;
  upcoming_milestones: Array<{
    id: number;
    project__code: string;
    project__name: string;
    name: string;
    due_date: string;
    status: string;
  }>;
  workload: Array<{
    assignee: string | null;
    name: string | null;
    count: number;
  }>;
};
const label = (value: string) => value.replaceAll("_", " ");
function BarList({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ label: string; count: number }>;
}) {
  const max = Math.max(...rows.map((row) => row.count), 1);
  return (
    <section className="rounded-lg border bg-card p-5">
      <h2 className="font-semibold">{title}</h2>
      <div className="mt-4 space-y-3">
        {rows.map((row) => (
          <div key={row.label}>
            <div className="flex justify-between text-sm">
              <span className="capitalize">{label(row.label)}</span>
              <span className="font-medium">{row.count}</span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded bg-muted">
              <div
                className="h-full bg-primary"
                style={{ width: `${(row.count / max) * 100}%` }}
              />
            </div>
          </div>
        ))}
        {!rows.length && (
          <p className="text-sm text-muted-foreground">No data available.</p>
        )}
      </div>
    </section>
  );
}

function ProjectProgress({
  projects,
}: {
  projects: Report["project_progress"];
}) {
  return (
    <section className="rounded-lg border bg-card p-5">
      <h2 className="font-semibold">Project Progress</h2>
      <div className="mt-4 space-y-3">
        {projects.map((project) => (
          <div key={project.code}>
            <div className="flex justify-between gap-3 text-sm">
              <span className="truncate">
                {project.code} · {project.name}
              </span>
              <span className="font-medium">
                {project.progress_percentage}%
              </span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded bg-muted">
              <div
                className="h-full bg-primary"
                style={{ width: `${project.progress_percentage}%` }}
              />
            </div>
          </div>
        ))}
        {!projects.length && (
          <p className="text-sm text-muted-foreground">
            No projects recorded yet.
          </p>
        )}
      </div>
    </section>
  );
}

function UpcomingMilestones({
  milestones,
}: {
  milestones: Report["upcoming_milestones"];
}) {
  return (
    <section className="rounded-lg border bg-card p-5">
      <h2 className="font-semibold">Upcoming Milestones</h2>
      <div className="mt-4 space-y-3">
        {milestones.map((milestone) => (
          <div className="rounded border p-3 text-sm" key={milestone.id}>
            <div className="font-medium">{milestone.name}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {milestone.project__code} · {milestone.project__name} · Due{" "}
              {milestone.due_date}
            </div>
          </div>
        ))}
        {!milestones.length && (
          <p className="text-sm text-muted-foreground">
            No upcoming milestones.
          </p>
        )}
      </div>
    </section>
  );
}

export default function ProjectsReports() {
  const { token, user } = useAuth();
  const { toast } = useToast();
  const [kind, setKind] = useState('tasks');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const params = new URLSearchParams({ report: kind, page: String(page), page_size: String(pageSize) });
  if (search.trim()) params.set('search', search.trim());
  if (status !== 'all') params.set('status', status);
  if (dateFrom) params.set('date_from', dateFrom);
  if (dateTo) params.set('date_to', dateTo);
  const exportReport = async (format: 'csv' | 'pdf') => {
    try {
      const query = new URLSearchParams(params);
      query.set('download', format);
      const response = await fetch(`/api/projects/reports/?${query}`, { headers: { Authorization: `Token ${token}` } });
      if (!response.ok) throw await apiErrorFromResponse(response, 'Report export failed.');
      if (format === 'pdf') return await downloadDocumentPdf(response, `projects-${kind}.pdf`);
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a'); link.href = url; link.download = `projects-${kind}.csv`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (error: any) { toast({ title: 'Report export failed', description: error.message, variant: 'destructive' }); }
  };
  const report = useQuery<Report>({
    queryKey: ["projects-reports", token, (user as any)?.organization_id, (user as any)?.branch_id, (user as any)?.active_role_group_name, params.toString()],
    enabled: !!token,
    queryFn: async () => {
      const response = await fetch(`/api/projects/reports/?${params}`, {
        headers: { Authorization: `Token ${token}` },
      });
      if (!response.ok)
        throw await apiErrorFromResponse(
          response,
          "Projects report could not be loaded.",
        );
      return response.json();
    },
  });
  const data = report.data;
  return (
    <ERPWorkspacePage
      title="Projects & Tasks Reports"
      description="Active-branch project delivery, ticket work, follow-ups, and workload."
    >
      <div className="mb-5 space-y-3 rounded-lg border bg-card p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-48 flex-1"><label className="mb-1 block text-xs text-muted-foreground">Report</label>
            <Select value={kind} onValueChange={(value) => { setKind(value); setPage(1); setSearch(''); setStatus('all'); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>
              {[['tasks', 'Task register'], ['projects', 'Project register'], ['follow-ups', 'Follow-up register'], ['workload', 'Assignee workload'], ['milestones', 'Project milestones']].map(([value, title]) => <SelectItem key={value} value={value}>{title}</SelectItem>)}
            </SelectContent></Select>
          </div>
          <Button variant="outline" disabled={!data?.can_export} onClick={() => void exportReport('csv')}>Export CSV</Button>
          <Button disabled={!data?.can_export} onClick={() => void exportReport('pdf')}>Download branded PDF</Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Input aria-label="Search report" placeholder="Search report records" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
          <Input aria-label="From date" type="date" value={dateFrom} onChange={(event) => { setDateFrom(event.target.value); setPage(1); }} />
          <Input aria-label="To date" type="date" value={dateTo} onChange={(event) => { setDateTo(event.target.value); setPage(1); }} />
          {kind === 'tasks' && <Select value={status} onValueChange={(value) => { setStatus(value); setPage(1); }}><SelectTrigger aria-label="Task status"><SelectValue /></SelectTrigger><SelectContent>{['all','draft','todo','in_progress','blocked','in_review','completed','cancelled'].map(value => <SelectItem key={value} value={value}>{value === 'all' ? 'All statuses' : label(value)}</SelectItem>)}</SelectContent></Select>}
        </div>
      </div>
      {report.isError && <p role="alert" className="mb-4 text-sm text-destructive">{report.error.message}</p>}
      <section className="mb-5 overflow-hidden rounded-lg border bg-card">
        <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm"><thead className="border-b bg-muted/40"><tr>{(data?.columns ?? []).map(column => <th className="px-4 py-3 text-left font-semibold" key={column}>{column}</th>)}</tr></thead>
          <tbody>{(data?.rows ?? []).map((row, index) => <tr className="border-b last:border-0" key={`${page}-${index}`}>{row.map((cell, column) => <td className="px-4 py-3" key={column}>{cell ?? '—'}</td>)}</tr>)}
          {!data?.rows?.length && <tr><td colSpan={data?.columns?.length || 1} className="p-8 text-center text-muted-foreground">{report.isLoading ? 'Loading report…' : 'No records match the current filters.'}</td></tr>}</tbody>
        </table></div>
        <ListingPagination page={page} pageSize={pageSize} totalCount={data?.count ?? 0} onPage={setPage} onPageSize={(value) => { setPageSize(value); setPage(1); }} />
      </section>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          ["Projects", data?.summary.projects],
          ["Active projects", data?.summary.active_projects],
          ["Open tasks", data?.summary.open_tasks],
          ["Overdue tasks", data?.summary.overdue_tasks],
          ["Ticket-linked tasks", data?.summary.ticket_tasks],
          ["Open follow-ups", data?.summary.open_follow_ups],
          ["Overdue follow-ups", data?.summary.overdue_follow_ups],
        ].map(([title, count]) => (
          <div className="rounded-lg border bg-card p-5" key={String(title)}>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {title}
            </div>
            <div className="mt-3 text-3xl font-bold">{count ?? 0}</div>
          </div>
        ))}
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <BarList
          title="Tasks by Status"
          rows={(data?.tasks_by_status ?? []).map((row) => ({
            label: row.status,
            count: row.count,
          }))}
        />
        <BarList
          title="Tasks by Priority"
          rows={(data?.tasks_by_priority ?? []).map((row) => ({
            label: row.priority,
            count: row.count,
          }))}
        />
        <BarList
          title="Open Workload by Assignee"
          rows={(data?.workload ?? []).map((row) => ({
            label: row.name || "Unassigned",
            count: row.count,
          }))}
        />
        <ProjectProgress projects={data?.project_progress ?? []} />
        <UpcomingMilestones milestones={data?.upcoming_milestones ?? []} />
      </div>
    </ERPWorkspacePage>
  );
}
