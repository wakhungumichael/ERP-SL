/* Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu. */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { Link } from "wouter";
import { useAuth } from "@/context/use-auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ListingPagination } from "@/components/erp/listing/pagination";
import { ERPWorkspacePage } from "@/components/erp/workspace/workspace-page";
import { apiErrorFromResponse } from "@/lib/api-errors";

type Task = {
  id: number;
  number: string;
  title: string;
  project: number | null;
  project_name: string;
  assignee_name: string;
  due_date: string | null;
  priority: string;
  progress_percentage: number;
  status: string;
  workflow_stage: string;
};
type Page = {
  count: number;
  results: Task[];
  access: { can_create: boolean; view_all_tasks: boolean };
};
type ProjectPage = {
  results: Array<{ id: number; code: string; name: string }>;
};
const columns = [
  ["draft", "Draft", "border-slate-200 bg-slate-50"],
  ["todo", "To Do", "border-slate-200 bg-slate-50"],
  ["in_progress", "In Progress", "border-blue-200 bg-blue-50"],
  ["in_review", "In Review", "border-amber-200 bg-amber-50"],
  ["blocked", "Blocked", "border-red-200 bg-red-50"],
  ["completed", "Completed", "border-emerald-200 bg-emerald-50"],
  ["cancelled", "Cancelled", "border-slate-200 bg-slate-50"],
] as const;

export default function ProjectKanban() {
  const { token, user } = useAuth();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [search, setSearch] = useState("");
  const [project, setProject] = useState("all");
  const query = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
  });
  if (search.trim()) query.set("search", search.trim());
  if (project !== "all") query.set("project", project);
  const tasks = useQuery<Page>({
    queryKey: [
      "projects-kanban",
      token,
      (user as any)?.organization_id,
      (user as any)?.branch_id,
      (user as any)?.active_role_group_name,
      search,
      project,
      page,
      pageSize,
    ],
    enabled: !!token,
    queryFn: async () => {
      const response = await fetch(`/api/projects/tasks/?${query.toString()}`, {
        headers: { Authorization: `Token ${token}` },
      });
      if (!response.ok)
        throw await apiErrorFromResponse(
          response,
          "Task board could not be loaded.",
        );
      return response.json();
    },
  });
  const projects = useQuery<ProjectPage>({
    queryKey: [
      "projects-kanban-options",
      token,
      (user as any)?.organization_id,
      (user as any)?.branch_id,
      (user as any)?.active_role_group_name,
    ],
    enabled: !!token,
    queryFn: async () => {
      const response = await fetch(
        "/api/projects/project-options/?page_size=100",
        {
          headers: { Authorization: `Token ${token}` },
        },
      );
      if (!response.ok)
        throw await apiErrorFromResponse(
          response,
          "Projects could not be loaded.",
        );
      return response.json();
    },
  });
  const list = tasks.data?.results ?? [];
  return (
    <ERPWorkspacePage
      title="Task Board"
      description="A branch-scoped view of work. Use the task record to update progress or forward it through approval."
    >
      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-1 flex-col gap-3 sm:flex-row">
          <Input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Search task number, title, or description"
            className="sm:max-w-md"
          />
          <Select
            value={project}
            onValueChange={(value) => {
              setProject(value);
              setPage(1);
            }}
          >
            <SelectTrigger className="sm:w-64">
              <SelectValue placeholder="All projects" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All projects</SelectItem>
              {(projects.data?.results ?? []).map((item) => (
                <SelectItem key={item.id} value={String(item.id)}>
                  {item.code} · {item.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {tasks.data?.access.can_create && (
          <Link
            href={
              project === "all"
                ? "/projects/tasks?create=1"
                : `/projects/tasks?project=${project}&create=1`
            }
          >
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              New task
            </Button>
          </Link>
        )}
      </div>
      {tasks.isError && (
        <p role="alert" className="mb-4 text-sm text-destructive">
          {tasks.error.message}
        </p>
      )}
      <p className="mb-3 text-xs text-muted-foreground">
        {tasks.isLoading
          ? "Loading tasks…"
          : `${tasks.data?.count ?? 0} accessible tasks · ${tasks.data?.access.view_all_tasks ? "Workspace view" : "Your work and role assignments"}`}
      </p>
      <div className="overflow-x-auto pb-3">
        <div className="grid min-w-max grid-flow-col auto-cols-[18rem] gap-4">
          {columns.map(([status, title, tone]) => {
            const columnTasks = list.filter((task) => task.status === status);
            return (
              <section
                className={`w-72 rounded-lg border p-3 ${tone}`}
                key={status}
              >
                <div className="flex items-center justify-between">
                  <h2 className="font-semibold">{title}</h2>
                  <Badge variant="outline">{columnTasks.length}</Badge>
                </div>
                <div className="mt-3 space-y-3">
                  {columnTasks.map((task) => (
                    <Link href={`/projects/tasks/${task.id}`} key={task.id}>
                      <article className="cursor-pointer rounded-md border bg-card p-3 shadow-sm transition hover:-translate-y-0.5 hover:shadow">
                        <div className="flex items-start justify-between gap-2">
                          <span className="font-mono text-xs text-muted-foreground">
                            {task.number}
                          </span>
                          <Badge variant="outline">{task.priority}</Badge>
                        </div>
                        <h3 className="mt-2 font-medium">{task.title}</h3>
                        <p className="mt-1 truncate text-xs text-muted-foreground">
                          {task.project_name || "Standalone task"}
                        </p>
                        <div className="mt-3 h-1.5 overflow-hidden rounded bg-muted">
                          <div
                            className="h-full bg-primary"
                            style={{ width: `${task.progress_percentage}%` }}
                          />
                        </div>
                        <div className="mt-2 flex justify-between text-xs text-muted-foreground">
                          <span>{task.assignee_name || "Unassigned"}</span>
                          <span>{task.progress_percentage}%</span>
                        </div>
                        {task.workflow_stage ? (
                          <p className="mt-2 text-xs text-muted-foreground">
                            Approval: {task.workflow_stage}
                          </p>
                        ) : null}
                      </article>
                    </Link>
                  ))}
                  {!columnTasks.length && (
                    <p className="rounded border border-dashed bg-card/50 p-4 text-center text-xs text-muted-foreground">
                      No tasks
                    </p>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </div>
      <ListingPagination
        page={page}
        pageSize={pageSize}
        totalCount={tasks.data?.count ?? 0}
        onPage={setPage}
        onPageSize={(value) => {
          setPageSize(value);
          setPage(1);
        }}
      />
    </ERPWorkspacePage>
  );
}
