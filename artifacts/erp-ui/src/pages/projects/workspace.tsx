import { Table } from "@/components/ui/table";
import { ERPFilterBar } from "@/components/erp/listing/filter-bar";
import { ERPListingScope } from "@/components/erp/listing/listing-scope";
import {
  useProjectSettings,
  dateAfterDays,
} from "@/components/projects/module-settings";
/* Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu. */
import { ReactNode, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useSearch } from "wouter";
import {
  BriefcaseBusiness,
  ClipboardList,
  ChevronDown,
  ChevronUp,
  Download,
  FolderKanban,
  ListTodo,
  Plus,
  Search,
  SlidersHorizontal,
  X,
  UserCheck,
} from "lucide-react";
import { useAuth } from "@/context/use-auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ProjectSelect,
  MilestoneSelect,
  TaskTypeSelect,
  TaskFilterFields,
  EMPTY_TASK_FILTERS,
  taskFilterParams,
} from "@/components/projects/task-fields";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { useToast } from "@/hooks/use-toast";

type PageMode = "overview" | "projects" | "tasks" | "mine" | "team";
type PageResult<T> = {
  count: number;
  results: T[];
  access?: { can_create: boolean; can_export: boolean };
};
type Project = {
  id: number;
  code: string;
  name: string;
  manager_name: string;
  branch_name: string;
  target_end_date: string | null;
  progress_percentage: number;
  status: string;
};
type Task = {
  is_active?: boolean;
  id: number;
  number: string;
  title: string;
  project: number;
  project_name: string;
  source_ticket_reference: string;
  assignee_name: string;
  priority: string;
  due_date: string | null;
  progress_percentage: number;
  status: string;
};
type Assignee = { id: number; name: string };

const statusTone: Record<string, string> = {
  active: "border-emerald-200 bg-emerald-50 text-emerald-700",
  completed: "border-emerald-200 bg-emerald-50 text-emerald-700",
  draft: "border-slate-200 bg-slate-50 text-slate-700",
  planned: "border-blue-200 bg-blue-50 text-blue-700",
  on_hold: "border-amber-200 bg-amber-50 text-amber-700",
  blocked: "border-red-200 bg-red-50 text-red-700",
  reopened: "border-orange-200 bg-orange-50 text-orange-700",
  in_progress: "border-blue-200 bg-blue-50 text-blue-700",
  in_review: "border-violet-200 bg-violet-50 text-violet-700",
  todo: "border-slate-200 bg-slate-50 text-slate-700",
};

function label(value: string) {
  return value.replaceAll("_", " ");
}

function useApi<T>(path: string, token: string | null, enabled = true) {
  const { user } = useAuth();
  const context = user as any;
  return useQuery<T>({
    queryKey: [
      "projects",
      path,
      token,
      context?.organization_id,
      context?.branch_id,
      context?.active_role_group_name,
    ],
    enabled: Boolean(token) && enabled,
    queryFn: async () => {
      const response = await fetch(path, {
        headers: { Authorization: `Token ${token}` },
      });
      if (!response.ok)
        throw await apiErrorFromResponse(
          response,
          "Projects & Tasks could not be loaded.",
        );
      return response.json() as Promise<T>;
    },
  });
}

function Metric({
  label: title,
  value,
  icon: Icon,
  href,
}: {
  label: string;
  value: number | undefined;
  icon: typeof BriefcaseBusiness;
  href?: string;
}) {
  const content = (
    <div className="rounded-lg border bg-card p-5 shadow-sm">
      <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <span>{title}</span>
        <Icon className="h-4 w-4 text-[#C4B13B]" />
      </div>
      <div className="mt-3 text-3xl font-bold tabular-nums">{value ?? 0}</div>
    </div>
  );
  return href ? (
    <Link href={href}>
      <div className="group cursor-pointer transition hover:-translate-y-0.5 hover:border-[#C4B13B]/70 hover:shadow-md">
        {content}
      </div>
    </Link>
  ) : (
    content
  );
}

function OverviewSection({
  title,
  description,
  action,
  children,
  defaultOpen = true,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="rounded-lg border bg-card shadow-sm">
      <div className="flex min-h-14 items-center justify-between gap-3 px-5 py-3">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
        >
          <span className="rounded-md bg-[#C4B13B]/10 p-2 text-[#9a8500]">
            <FolderKanban className="h-4 w-4" />
          </span>
          <span className="min-w-0">
            <span className="block font-semibold">{title}</span>
            {description ? (
              <span className="block truncate text-sm text-muted-foreground">
                {description}
              </span>
            ) : null}
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-2">
          {open ? action : null}
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setOpen((value) => !value)}
            aria-label={`${open ? "Collapse" : "Expand"} ${title}`}
          >
            {open ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
      {open ? <div className="border-t p-5">{children}</div> : null}
    </section>
  );
}

function Distribution({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ status?: string; priority?: string; count: number }>;
}) {
  const maximum = Math.max(...rows.map((row) => row.count), 1);
  return (
    <section className="rounded-lg border bg-card p-5">
      <h2 className="font-semibold">{title}</h2>
      <div className="mt-4 space-y-3">
        {rows.map((row) => {
          const value = row.status || row.priority || "Unspecified";
          return (
            <div key={value}>
              <div className="flex justify-between text-sm">
                <span className="capitalize">{label(value)}</span>
                <span className="font-medium">{row.count}</span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded bg-muted">
                <div
                  className="h-full bg-[#C4B13B]"
                  style={{ width: `${(row.count / maximum) * 100}%` }}
                />
              </div>
            </div>
          );
        })}
        {!rows.length && (
          <p className="text-sm text-muted-foreground">
            No tasks recorded yet.
          </p>
        )}
      </div>
    </section>
  );
}

export default function ProjectsWorkspace({ mode }: { mode: PageMode }) {
  const [location, navigate] = useLocation();
  const routeSearch = useSearch();
  const { token } = useAuth();
  const { toast } = useToast();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [ordering, setOrdering] = useState("-created_at");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [clearSamplesOpen, setClearSamplesOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [recordTitle, setRecordTitle] = useState("");
  const [recordDescription, setRecordDescription] = useState("");
  const [taskProject, setTaskProject] = useState("");
  const [taskMilestone, setTaskMilestone] = useState("none");
  const [taskFilters, setTaskFilters] = useState({ ...EMPTY_TASK_FILTERS });
  const [taskAssignee, setTaskAssignee] = useState("unassigned");
  const [taskType, setTaskType] = useState("general");
  const [taskStatus, setTaskStatus] = useState("draft");
  const [taskPriority, setTaskPriority] = useState("medium");
  const [taskStartDate, setTaskStartDate] = useState("");
  const [taskDueDate, setTaskDueDate] = useState("");
  const [taskEstimatedHours, setTaskEstimatedHours] = useState("");
  const [projectPriority, setProjectPriority] = useState("medium");
  const [projectStartDate, setProjectStartDate] = useState("");
  const [projectTargetEndDate, setProjectTargetEndDate] = useState("");
  const queryClient = useQueryClient();
  const moduleSettings = useProjectSettings();
  useEffect(() => {
    if (!createOpen && moduleSettings.data) {
      const config = moduleSettings.data;
      setTaskType(config.default_task_type);
      setTaskPriority(config.default_priority);
      setTaskStatus(config.default_task_status);
      setTaskDueDate(
        config.default_due_days === null
          ? ""
          : dateAfterDays(config.default_due_days),
      );
    }
  }, [createOpen, moduleSettings.data]);

  const exportRegister = async () => {
    try {
      const response = await fetch(
        isProjects
          ? `/api/projects/projects/export/?${query}`
          : `/api/projects/tasks/export/?${query}`,
        { headers: { Authorization: `Token ${token}` } },
      );
      if (!response.ok)
        throw await apiErrorFromResponse(
          response,
          "Export could not be prepared.",
        );
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = isProjects ? "projects.csv" : "project-tasks.csv";
      link.click();
      URL.revokeObjectURL(url);
      toast({ title: "CSV export downloaded" });
    } catch (error) {
      toast({
        title: "Could not export register",
        description:
          error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };
  const clearSamples = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/projects/sample-data/", {
        method: "DELETE",
        headers: { Authorization: `Token ${token}` },
      });
      if (!response.ok)
        throw await apiErrorFromResponse(
          response,
          "Sample tasks could not be deactivated.",
        );
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
      setClearSamplesOpen(false);
      toast({ title: "Sample tasks deactivated" });
    },
    onError: (error: Error) =>
      toast({
        title: "Sample data retained",
        description: error.message,
        variant: "destructive",
      }),
  });

  const createRecord = useMutation({
    mutationFn: async () => {
      if (
        !isProjects &&
        taskStartDate &&
        taskDueDate &&
        taskDueDate < taskStartDate
      ) {
        throw new Error("Due date cannot be before the task start date.");
      }
      if (
        isProjects &&
        projectStartDate &&
        projectTargetEndDate &&
        projectTargetEndDate < projectStartDate
      ) {
        throw new Error(
          "Target end date cannot be before the project start date.",
        );
      }
      if (
        taskEstimatedHours &&
        (!Number.isFinite(Number(taskEstimatedHours)) ||
          Number(taskEstimatedHours) < 0)
      ) {
        throw new Error("Estimated hours must be zero or more.");
      }
      if (!isProjects && !taskProject)
        throw new Error("Choose a project for this task.");
      if (!isProjects && (!taskType.trim() || taskType === "other"))
        throw new Error("Choose a task type or specify a name for Other.");
      const taskPayload = {
        title: recordTitle,
        description: recordDescription,
        status: taskStatus,
        project: Number(taskProject),
        milestone: taskMilestone === "none" ? null : Number(taskMilestone),
        primary_assignee:
          taskAssignee === "unassigned" ? null : Number(taskAssignee),
        task_type: taskType,
        priority: taskPriority,
        start_date: taskStartDate || null,
        due_date: taskDueDate || null,
        estimated_hours: taskEstimatedHours || null,
      };
      const projectPayload = {
        name: recordTitle,
        description: recordDescription,
        status: "draft",
        priority: projectPriority,
        start_date: projectStartDate || null,
        target_end_date: projectTargetEndDate || null,
      };
      const response = await fetch(
        isProjects ? "/api/projects/projects/" : "/api/projects/tasks/",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Token ${token}`,
          },
          body: JSON.stringify(isProjects ? projectPayload : taskPayload),
        },
      );
      if (!response.ok)
        throw await apiErrorFromResponse(
          response,
          `${isProjects ? "Project" : "Task"} could not be created.`,
        );
      return response.json();
    },
    onSuccess: (created: Project | Task) => {
      setCreateOpen(false);
      setRecordTitle("");
      setRecordDescription("");
      setTaskProject("");
      setTaskMilestone("none");
      setTaskAssignee("unassigned");
      setTaskType("general");
      setTaskPriority("medium");
      setTaskStartDate("");
      setTaskDueDate("");
      setTaskEstimatedHours("");
      setProjectPriority("medium");
      setProjectStartDate("");
      setProjectTargetEndDate("");
      // Show the saved record first instead of keeping filters or a later page.
      setSearch("");
      setStatus("all");
      setTaskFilters({ ...EMPTY_TASK_FILTERS });
      setDateFrom("");
      setDateTo("");
      setPage(1);
      setOrdering("-created_at");
      const nextQuery = new URLSearchParams(routeSearch);
      nextQuery.delete("create");
      if (!isProjects && nextQuery.has("project")) {
        nextQuery.set("project", String((created as Task).project));
      }
      if (
        nextQuery.toString() !== new URLSearchParams(routeSearch).toString()
      ) {
        navigate(`${location}${nextQuery.size ? `?${nextQuery}` : ""}`, {
          replace: true,
        });
      }
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast({
        title: `${isProjects ? "Project" : "Task"} created`,
        description: isProjects
          ? (created as Project).name
          : `${(created as Task).number}: ${(created as Task).title}`,
      });
    },
    onError: (error: Error) =>
      toast({
        title: `Could not create ${isProjects ? "Project" : "Task"}`,
        description: error.message,
        variant: "destructive",
      }),
  });
  const metrics = useApi<{
    access: {
      view_all_tasks: boolean;
      role: string;
      can_create_task: boolean;
      can_create_project: boolean;
      can_export: boolean;
      can_manage_samples: boolean;
      has_samples: boolean;
    };
    counts: Record<string, number>;
    recent_tasks: Task[];
    upcoming_deadlines: Task[];
    tasks_by_status: Array<{ status: string; count: number }>;
    tasks_by_priority: Array<{ priority: string; count: number }>;
  }>("/api/projects/dashboard/", token, mode === "overview");
  const isProjects = mode === "projects";
  const routeQuery = new URLSearchParams(routeSearch);
  const requestedProject = routeQuery.get("project") || "";
  const shouldCreateTask = routeQuery.get("create") === "1";
  useEffect(() => {
    setStatus("all");
    setOrdering(mode === "projects" ? "-created_at" : "due_date");
    setDateFrom("");
    setDateTo("");
    setPage(1);
  }, [mode]);
  useEffect(() => {
    if (mode === "tasks" && shouldCreateTask) {
      if (requestedProject) setTaskProject(requestedProject);
      setCreateOpen(true);
    }
  }, [mode, requestedProject, shouldCreateTask]);
  const endpoint = isProjects
    ? "/api/projects/projects/"
    : "/api/projects/tasks/";
  const assigneeChoices = useApi<Assignee[]>(
    `/api/projects/tasks/assignees/?project=${taskProject}`,
    token,
    createOpen && !isProjects && Boolean(taskProject),
  );
  const query = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
  });
  if (search) query.set("search", search);
  if (status !== "all") query.set("status", status);
  query.set("ordering", ordering);
  if (dateFrom) query.set("date_from", dateFrom);
  if (dateTo) query.set("date_to", dateTo);
  if (!isProjects)
    for (const [key, value] of Object.entries(taskFilterParams(taskFilters)))
      query.set(key, value);
  if (!isProjects && requestedProject) query.set("project", requestedProject);
  if (mode === "mine") query.set("scope", "mine");
  if (mode === "team") query.set("scope", "team");
  const records = useApi<PageResult<Project | Task>>(
    `${endpoint}?${query}`,
    token,
    mode !== "overview",
  );
  const title =
    mode === "overview"
      ? "Projects & Tasks"
      : isProjects
        ? "Projects"
        : mode === "mine"
          ? "My Tasks"
          : mode === "team"
            ? "Project team"
            : "All Tasks";

  if (mode === "overview") {
    const counts = metrics.data?.counts;
    return (
      <ERPWorkspacePage
        title={title}
        description={`${metrics.data?.access.role?.split(":").pop() || "Your workspace"} · ${metrics.data?.access.view_all_tasks ? "All permitted branch tasks" : "Your assigned work, collaborations, and role tasks"}`}
      >
        {metrics.data?.access.can_manage_samples &&
        metrics.data?.access.has_samples ? (
          <div className="mb-4 flex justify-end">
            <Button variant="outline" onClick={() => setClearSamplesOpen(true)}>
              Deactivate sample tasks
            </Button>
          </div>
        ) : null}
        <Dialog open={clearSamplesOpen} onOpenChange={setClearSamplesOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                Deactivate this organization's sample tasks?
              </DialogTitle>
            </DialogHeader>
            <p>
              Deactivates sample tasks visible in the current branch. Records,
              assignments, project links, and history are retained.
            </p>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setClearSamplesOpen(false)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={clearSamples.isPending}
                onClick={() => clearSamples.mutate()}
              >
                Deactivate sample tasks
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <OverviewSection
          title="Work overview"
          description="A live summary for your active branch and selected role. Select a card to drill into the matching register."
          action={
            <Link href="/projects/tasks">
              <Button size="sm" variant="outline">
                <ListTodo className="mr-2 h-4 w-4" />
                View all tasks
              </Button>
            </Link>
          }
        >
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Metric
              label="Active projects"
              value={counts?.active_projects}
              icon={BriefcaseBusiness}
              href="/projects?status=active"
            />
            <Metric
              label="Open tasks"
              value={counts?.open_tasks}
              icon={ClipboardList}
              href="/projects/tasks?status=todo"
            />
            <Metric
              label="My tasks"
              value={counts?.my_tasks}
              icon={UserCheck}
              href="/projects/my-tasks"
            />
            <Metric
              label="Overdue tasks"
              value={counts?.overdue_tasks}
              icon={ClipboardList}
              href="/projects/tasks?overdue=1"
            />
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <Metric
              label="Blocked tasks"
              value={counts?.blocked_tasks}
              icon={ClipboardList}
              href="/projects/tasks?status=blocked"
            />
            <Metric
              label="Awaiting review"
              value={counts?.awaiting_review}
              icon={UserCheck}
              href="/projects/tasks?status=in_review"
            />
            <Metric
              label="Ticket-linked tasks"
              value={counts?.ticket_tasks}
              icon={BriefcaseBusiness}
              href="/projects/tasks?ticket_linked=1"
            />
          </div>
        </OverviewSection>
        <div className="mt-5 grid gap-5 xl:grid-cols-2">
          <OverviewSection
            title="Task health"
            description="Status and priority distribution across work you are permitted to see."
          >
            <div className="grid gap-4 lg:grid-cols-2">
              <Distribution
                title="Tasks by status"
                rows={metrics.data?.tasks_by_status ?? []}
              />
              <Distribution
                title="Tasks by priority"
                rows={metrics.data?.tasks_by_priority ?? []}
              />
            </div>
          </OverviewSection>
          <OverviewSection
            title="Quick actions"
            description="Start work or go directly to your operating views."
            defaultOpen={false}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Link href="/projects">
                <Button className="w-full justify-between" variant="outline">
                  View projects <ChevronDown className="h-4 w-4 -rotate-90" />
                </Button>
              </Link>
              <Link href="/projects/tasks?create=1">
                <Button className="w-full justify-between">
                  Create task <Plus className="h-4 w-4" />
                </Button>
              </Link>
              <Link href="/projects/task-board">
                <Button className="w-full justify-between" variant="outline">
                  Open task board <ChevronDown className="h-4 w-4 -rotate-90" />
                </Button>
              </Link>
              <Link href="/projects/calendar">
                <Button className="w-full justify-between" variant="outline">
                  View calendar <ChevronDown className="h-4 w-4 -rotate-90" />
                </Button>
              </Link>
            </div>
          </OverviewSection>
        </div>
        <div className="mt-5 grid gap-5 xl:grid-cols-2">
          <OverviewSection
            title="Recent task activity"
            description="Latest changes to work in your permitted scope."
            action={
              <Link href="/projects/tasks">
                <Button size="sm" variant="ghost">
                  View all
                </Button>
              </Link>
            }
          >
            <div className="mt-3 space-y-2">
              {(metrics.data?.recent_tasks ?? []).map((task) => (
                <Link href={`/projects/tasks/${task.id}`} key={task.id}>
                  <div className="flex cursor-pointer items-center justify-between gap-3 rounded border p-3 text-sm hover:bg-muted/40">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{task.title}</div>
                      <div className="text-xs text-muted-foreground">
                        {task.number} · {task.assignee_name || "Unassigned"}
                      </div>
                    </div>
                    <Badge variant="outline">{label(task.status)}</Badge>
                  </div>
                </Link>
              ))}
              {!metrics.data?.recent_tasks.length && (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No project task activity yet.
                </p>
              )}
            </div>
          </OverviewSection>
          <OverviewSection
            title="Upcoming deadlines"
            description="Open tasks ordered by their due date."
            action={
              <Link href="/projects/calendar">
                <Button size="sm" variant="ghost">
                  View calendar
                </Button>
              </Link>
            }
          >
            <div className="mt-3 space-y-2">
              {(metrics.data?.upcoming_deadlines ?? []).map((task) => (
                <Link href={`/projects/tasks/${task.id}`} key={task.id}>
                  <div className="flex cursor-pointer items-center justify-between gap-3 rounded border p-3 text-sm hover:bg-muted/40">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{task.title}</div>
                      <div className="text-xs text-muted-foreground">
                        Due {task.due_date || "Not set"} · {task.priority}{" "}
                        priority
                      </div>
                    </div>
                    <Badge variant="outline">{label(task.status)}</Badge>
                  </div>
                </Link>
              ))}
              {!metrics.data?.upcoming_deadlines.length && (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No dated open tasks.
                </p>
              )}
            </div>
          </OverviewSection>
        </div>
      </ERPWorkspacePage>
    );
  }

  const items = records.data?.results ?? [];
  const filtersActive =
    (!isProjects && Object.keys(taskFilterParams(taskFilters)).length > 0) ||
    status !== "all" ||
    dateFrom !== "" ||
    dateTo !== "" ||
    ordering !== (isProjects ? "-created_at" : "due_date");
  const clearFilters = () => {
    setTaskFilters({ ...EMPTY_TASK_FILTERS });
    setStatus("all");
    setOrdering(isProjects ? "-created_at" : "due_date");
    setDateFrom("");
    setDateTo("");
    setPage(1);
  };
  return <ERPListingScope>{(
    <ERPWorkspacePage
      title={title}
      description={
        mode === "mine"
          ? "Tasks assigned to you in your active branch and role."
          : mode === "team"
            ? "Project team tasks available to you in the active branch, including unassigned work."
            : isProjects
              ? "Projects available to you in the active branch."
              : "Tasks in your projects and assigned work. Branch-wide viewing requires the corresponding permission."
      }
    >
      <ERPFilterBar searchSlot={<div className="relative max-w-md flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-9"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder={
                isProjects ? "Search projects..." : "Search tasks..."
              }
            />
          </div>} filterControl={<Button
            onClick={() => setFiltersOpen((open) => !open)}
            variant={filtersActive ? "default" : "outline"}
          >
            <SlidersHorizontal className="mr-2 h-4 w-4" />
            Filters{filtersActive ? " active" : ""}
          </Button>} toolsSlot={<> <Button
            variant="outline"
            onClick={() => void exportRegister()}
            disabled={!records.data?.access?.can_export}
          >
            <Download className="mr-2 h-4 w-4" />
            Export CSV
          </Button>
{records.data?.access?.can_create && (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              New {isProjects ? "Project" : "Task"}
            </Button>
          )} </>} />
      {filtersOpen && (
        <section className="mb-4 rounded-lg border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Filters and sorting</h2>
            {filtersActive && (
              <Button onClick={clearFilters} size="sm" variant="ghost">
                <X className="mr-1 h-3.5 w-3.5" />
                Clear
              </Button>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Select
              value={status}
              onValueChange={(value) => {
                setStatus(value);
                setPage(1);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                {isProjects ? (
                  <>
                    <SelectItem value="planned">Planned</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="on_hold">On hold</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                    <SelectItem value="archived">Archived</SelectItem>
                  </>
                ) : (
                  <>
                    <SelectItem value="todo">To do</SelectItem>
                    <SelectItem value="in_progress">In progress</SelectItem>
                    <SelectItem value="blocked">Blocked</SelectItem>
                    <SelectItem value="reopened">Reopened</SelectItem>
                    <SelectItem value="in_review">In review</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </>
                )}
              </SelectContent>
            </Select>
            <Select
              value={ordering}
              onValueChange={(value) => {
                setOrdering(value);
                setPage(1);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Sort records" />
              </SelectTrigger>
              <SelectContent>
                {isProjects ? (
                  <>
                    <SelectItem value="-created_at">Newest created</SelectItem>
                    <SelectItem value="created_at">Oldest created</SelectItem>
                    <SelectItem value="target_end_date">
                      Due date: earliest
                    </SelectItem>
                    <SelectItem value="-target_end_date">
                      Due date: latest
                    </SelectItem>
                    <SelectItem value="-progress_percentage">
                      Progress: highest
                    </SelectItem>
                    <SelectItem value="progress_percentage">
                      Progress: lowest
                    </SelectItem>
                    <SelectItem value="name">Project name: A–Z</SelectItem>
                  </>
                ) : (
                  <>
                    <SelectItem value="due_date">Due date: earliest</SelectItem>
                    <SelectItem value="-due_date">Due date: latest</SelectItem>
                    <SelectItem value="-created_at">Newest created</SelectItem>
                    <SelectItem value="created_at">Oldest created</SelectItem>
                    <SelectItem value="priority">Priority</SelectItem>
                    <SelectItem value="-progress_percentage">
                      Progress: highest
                    </SelectItem>
                    <SelectItem value="title">Task title: A–Z</SelectItem>
                  </>
                )}
              </SelectContent>
            </Select>
            <div className="space-y-2">
              <Label htmlFor="task-filter-date-from">
                {isProjects ? "Start date from" : "Due date from"}
              </Label>
              <Input
                id="task-filter-date-from"
                aria-label={
                  isProjects ? "Project start date from" : "Task due date from"
                }
                max={dateTo || undefined}
                onChange={(event) => {
                  setDateFrom(event.target.value);
                  setPage(1);
                }}
                type="date"
                value={dateFrom}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="task-filter-date-to">
                {isProjects ? "Target end date to" : "Due date to"}
              </Label>
              <Input
                id="task-filter-date-to"
                aria-label={
                  isProjects ? "Project due date to" : "Task due date to"
                }
                min={dateFrom || undefined}
                onChange={(event) => {
                  setDateTo(event.target.value);
                  setPage(1);
                }}
                type="date"
                value={dateTo}
              />
            </div>
          </div>
          {!isProjects && (
            <div className="mt-4 border-t pt-4">
              <TaskFilterFields
                value={taskFilters}
                projectId={requestedProject || undefined}
                onChange={(value) => {
                  setTaskFilters(value);
                  setPage(1);
                }}
              />
            </div>
          )}
        </section>
      )}
      <div className="overflow-hidden rounded-lg border bg-card">
        <Table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              {(isProjects
                ? [
                    "Code",
                    "Project",
                    "Manager",
                    "Branch",
                    "Due date",
                    "Progress",
                    "Status",
                  ]
                : [
                    "Number",
                    "Task",
                    "Project",
                    "Source ticket",
                    "Assigned to",
                    "Priority",
                    "Due date",
                    "Progress",
                    "Status",
                  ]
              ).map((column) => (
                <th className="px-4 py-3 font-semibold" key={column}>
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const project = item as Project;
              const task = item as Task;
              const reference = isProjects ? project.code : task.number;
              const name = isProjects ? project.name : task.title;
              const assignee = isProjects
                ? project.manager_name
                : task.assignee_name;
              const due = isProjects ? project.target_end_date : task.due_date;
              const progress = isProjects
                ? project.progress_percentage
                : task.progress_percentage;
              const currentStatus = isProjects ? project.status : task.status;
              return (
                <tr
                  className="cursor-pointer border-b last:border-0 hover:bg-muted/25"
                  key={item.id}
                  onClick={() =>
                    navigate(
                      isProjects
                        ? `/projects/${item.id}`
                        : `/projects/tasks/${item.id}`,
                    )
                  }
                >
                  <td className="px-4 py-3 font-mono text-xs">{reference}</td>
                  <td className="px-4 py-3 font-medium">{name}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {isProjects
                      ? assignee || "Unassigned"
                      : task.project_name || "General"}
                  </td>
                  {!isProjects && (
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {task.source_ticket_reference || "—"}
                    </td>
                  )}
                  <td className="px-4 py-3 text-muted-foreground">
                    {isProjects
                      ? project.branch_name
                      : assignee || "Unassigned"}
                  </td>
                  {!isProjects && (
                    <td className="px-4 py-3">
                      <Badge variant="outline">{task.priority}</Badge>
                    </td>
                  )}
                  <td className="px-4 py-3 text-muted-foreground">
                    {due || "—"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-16 overflow-hidden rounded bg-muted">
                        <div
                          className="h-full bg-[#C4B13B]"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                      <span className="text-xs">{progress}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      variant="outline"
                      className={statusTone[currentStatus] ?? ""}
                    >
                      {!isProjects && task.is_active === false
                        ? "Inactive · "
                        : ""}
                      {label(currentStatus)}
                    </Badge>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
        {records.isError && (
          <p role="alert" className="p-4 text-sm text-destructive">
            {records.error.message}
          </p>
        )}
        {!records.isLoading && !records.isError && !items.length && (
          <div className="p-10 text-center text-sm text-muted-foreground">
            No records match the selected filters.
          </div>
        )}
        <ListingPagination
          page={page}
          pageSize={pageSize}
          totalCount={records.data?.count ?? 0}
          onPage={setPage}
          onPageSize={setPageSize}
        />
      </div>
      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (open && requestedProject) setTaskProject(requestedProject);
        }}
      >
        <DialogContent className="flex max-h-[calc(100dvh_-_2rem)] w-[calc(100vw_-_2rem)] max-w-4xl flex-col gap-0 overflow-hidden p-0 sm:rounded-xl">
          <DialogHeader className="shrink-0 border-b px-4 py-5 pr-12 text-left sm:px-6 sm:pr-12">
            <DialogTitle>New {isProjects ? "Project" : "Task"}</DialogTitle>
            <DialogDescription>
              {isProjects
                ? "Add the project details and planned dates. You can update the draft before starting work."
                : "Add the task details, assignment, and schedule. You can update the draft before starting work."}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-5 sm:px-6">
            <div className="space-y-2">
              <Label htmlFor="new-record-title" required>
                {isProjects ? "Project name" : "Task title"}
              </Label>
              <Input
                id="new-record-title"
                required
                value={recordTitle}
                onChange={(event) => setRecordTitle(event.target.value)}
                placeholder={isProjects ? "Project name" : "Task title"}
                className="h-11"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-record-description">
                Description{" "}
                <span className="font-normal text-muted-foreground">
                  (optional)
                </span>
              </Label>
              <Textarea
                id="new-record-description"
                value={recordDescription}
                onChange={(event) => setRecordDescription(event.target.value)}
                placeholder={
                  isProjects
                    ? "Describe the expected outcome"
                    : "Describe the expected deliverable"
                }
                className="min-h-28"
              />
            </div>
            {isProjects && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div className="min-w-0 space-y-2 sm:col-span-2 lg:col-span-1">
                  <Label htmlFor="new-project-priority">Priority</Label>
                  <Select
                    value={projectPriority}
                    onValueChange={setProjectPriority}
                  >
                    <SelectTrigger
                      id="new-project-priority"
                      className="h-11 min-w-0"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low priority</SelectItem>
                      <SelectItem value="medium">Medium priority</SelectItem>
                      <SelectItem value="high">High priority</SelectItem>
                      <SelectItem value="critical">
                        Critical priority
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="min-w-0 space-y-2">
                  <Label htmlFor="new-project-start-date">Start date</Label>
                  <Input
                    id="new-project-start-date"
                    type="date"
                    value={projectStartDate}
                    onChange={(event) =>
                      setProjectStartDate(event.target.value)
                    }
                    aria-describedby="new-project-start-help"
                    className="h-11 min-w-0"
                  />
                  <p
                    id="new-project-start-help"
                    className="text-xs text-muted-foreground"
                  >
                    Planned first day of work.
                  </p>
                </div>
                <div className="min-w-0 space-y-2">
                  <Label htmlFor="new-project-target-end-date">
                    Target end date
                  </Label>
                  <Input
                    id="new-project-target-end-date"
                    type="date"
                    value={projectTargetEndDate}
                    min={projectStartDate || undefined}
                    onChange={(event) =>
                      setProjectTargetEndDate(event.target.value)
                    }
                    aria-describedby="new-project-end-help"
                    className="h-11 min-w-0"
                  />
                  <p
                    id="new-project-end-help"
                    className="text-xs text-muted-foreground"
                  >
                    Expected project completion date.
                  </p>
                </div>
              </div>
            )}
            {!isProjects && (
              <>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="min-w-0 space-y-2">
                    <Label htmlFor="new-task-project" required>
                      Project
                    </Label>
                    <ProjectSelect
                      id="new-task-project"
                      value={taskProject}
                      defaultGeneral
                      onChange={(value) => {
                        setTaskProject(value);
                        setTaskMilestone("none");
                        setTaskAssignee("unassigned");
                      }}
                    />
                  </div>
                  <div className="min-w-0 space-y-2">
                    <Label htmlFor="new-task-assignee">
                      Assignee{" "}
                      <span className="font-normal text-muted-foreground">
                        (optional)
                      </span>
                    </Label>
                    <Select
                      value={taskAssignee}
                      onValueChange={setTaskAssignee}
                    >
                      <SelectTrigger
                        id="new-task-assignee"
                        className="h-11 min-w-0"
                      >
                        <SelectValue placeholder="Assign to (optional)" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unassigned">
                          Leave unassigned
                        </SelectItem>
                        {(assigneeChoices.data ?? []).map((assignee) => (
                          <SelectItem
                            key={assignee.id}
                            value={String(assignee.id)}
                          >
                            {assignee.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-task-milestone">
                    Milestone (optional)
                  </Label>
                  <MilestoneSelect
                    id="new-task-milestone"
                    projectId={taskProject}
                    value={taskMilestone}
                    onChange={setTaskMilestone}
                  />
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <div className="min-w-0 space-y-2">
                    <Label htmlFor="new-task-type">Task type</Label>
                    <TaskTypeSelect
                      id="new-task-type"
                      value={taskType}
                      onChange={setTaskType}
                    />
                  </div>
                  <div className="min-w-0 space-y-2">
                    <Label htmlFor="new-task-priority">Priority</Label>
                    <Select
                      value={taskPriority}
                      onValueChange={setTaskPriority}
                    >
                      <SelectTrigger
                        id="new-task-priority"
                        className="h-11 min-w-0"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">Low</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="high">High</SelectItem>
                        <SelectItem value="critical">Critical</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="min-w-0 space-y-2">
                    <Label htmlFor="new-task-start-date">Start date</Label>
                    <Input
                      id="new-task-start-date"
                      type="date"
                      value={taskStartDate}
                      onChange={(event) => setTaskStartDate(event.target.value)}
                      className="h-11 min-w-0"
                    />
                  </div>
                  <div className="min-w-0 space-y-2">
                    <Label htmlFor="new-task-due-date">Due date</Label>
                    <Input
                      id="new-task-due-date"
                      type="date"
                      value={taskDueDate}
                      min={taskStartDate || undefined}
                      onChange={(event) => setTaskDueDate(event.target.value)}
                      className="h-11 min-w-0"
                    />
                  </div>
                  <div className="min-w-0 space-y-2">
                    <Label htmlFor="new-task-estimated-hours">
                      Estimated hours
                    </Label>
                    <Input
                      id="new-task-estimated-hours"
                      type="number"
                      min="0"
                      step="0.25"
                      value={taskEstimatedHours}
                      placeholder="Estimated hours"
                      onChange={(event) =>
                        setTaskEstimatedHours(event.target.value)
                      }
                      className="h-11"
                    />
                  </div>
                </div>
              </>
            )}
          </div>
          <DialogFooter className="shrink-0 gap-2 border-t bg-muted/20 px-4 py-4 sm:space-x-0 sm:px-6">
            <Button
              variant="outline"
              className="h-11 w-full sm:w-auto"
              onClick={() => setCreateOpen(false)}
            >
              Cancel
            </Button>
            <Button
              className="h-11 w-full sm:w-auto"
              disabled={
                !recordTitle.trim() ||
                (!isProjects && !taskProject) ||
                createRecord.isPending
              }
              onClick={() => createRecord.mutate()}
            >
              {isProjects
                ? "Create draft project"
                : taskStatus === "todo"
                  ? "Create task"
                  : "Create draft task"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ERPWorkspacePage>
  )}</ERPListingScope>;
}
