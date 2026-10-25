/* Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu. */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import {
  BriefcaseBusiness,
  ClipboardList,
  Download,
  Plus,
  Search,
  UserCheck,
} from "lucide-react";
import { useAuth } from "@/context/use-auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
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
type PageResult<T> = { count: number; results: T[] };
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
  id: number;
  number: string;
  title: string;
  project_name: string;
  assignee_name: string;
  priority: string;
  due_date: string | null;
  progress_percentage: number;
  status: string;
};

const statusTone: Record<string, string> = {
  active: "border-emerald-200 bg-emerald-50 text-emerald-700",
  completed: "border-emerald-200 bg-emerald-50 text-emerald-700",
  draft: "border-slate-200 bg-slate-50 text-slate-700",
  planned: "border-blue-200 bg-blue-50 text-blue-700",
  on_hold: "border-amber-200 bg-amber-50 text-amber-700",
  blocked: "border-red-200 bg-red-50 text-red-700",
  in_progress: "border-blue-200 bg-blue-50 text-blue-700",
  in_review: "border-violet-200 bg-violet-50 text-violet-700",
  todo: "border-slate-200 bg-slate-50 text-slate-700",
};

function label(value: string) {
  return value.replaceAll("_", " ");
}

function useApi<T>(path: string, token: string | null) {
  return useQuery<T>({
    queryKey: ["projects", path],
    enabled: Boolean(token),
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
}: {
  label: string;
  value: number | undefined;
  icon: typeof BriefcaseBusiness;
}) {
  return (
    <div className="rounded-lg border bg-card p-5 shadow-sm">
      <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <span>{title}</span>
        <Icon className="h-4 w-4 text-[#C4B13B]" />
      </div>
      <div className="mt-3 text-3xl font-bold tabular-nums">{value ?? 0}</div>
    </div>
  );
}

export default function ProjectsWorkspace({ mode }: { mode: PageMode }) {
  const [location, navigate] = useLocation();
  const { token } = useAuth();
  const { toast } = useToast();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [recordTitle, setRecordTitle] = useState("");
  const [recordDescription, setRecordDescription] = useState("");
  const [taskProject, setTaskProject] = useState("none");
  const [taskType, setTaskType] = useState("");
  const [taskPriority, setTaskPriority] = useState("medium");
  const [taskStartDate, setTaskStartDate] = useState("");
  const [taskDueDate, setTaskDueDate] = useState("");
  const [taskEstimatedHours, setTaskEstimatedHours] = useState("");
  const [projectPriority, setProjectPriority] = useState("medium");
  const [projectStartDate, setProjectStartDate] = useState("");
  const [projectTargetEndDate, setProjectTargetEndDate] = useState("");
  const queryClient = useQueryClient();
  const exportRegister = async () => {
    try {
      const response = await fetch(
        isProjects
          ? "/api/projects/projects/export/"
          : "/api/projects/tasks/export/",
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
      const taskPayload = {
        title: recordTitle,
        description: recordDescription,
        status: "draft",
        project: taskProject === "none" ? null : Number(taskProject),
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
    onSuccess: () => {
      setCreateOpen(false);
      setRecordTitle("");
      setRecordDescription("");
      setTaskProject("none");
      setTaskType("");
      setTaskPriority("medium");
      setTaskStartDate("");
      setTaskDueDate("");
      setTaskEstimatedHours("");
      setProjectPriority("medium");
      setProjectStartDate("");
      setProjectTargetEndDate("");
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast({ title: `Draft ${isProjects ? "project" : "task"} created` });
    },
    onError: (error: Error) =>
      toast({
        title: `Could not create ${isProjects ? "Project" : "Task"}`,
        description: error.message,
        variant: "destructive",
      }),
  });
  const metrics = useApi<{
    counts: Record<string, number>;
    recent_tasks: Task[];
    upcoming_deadlines: Task[];
  }>("/api/projects/dashboard/", token);
  const isProjects = mode === "projects";
  const routeQuery = new URLSearchParams(location.split("?")[1] || "");
  const requestedProject = routeQuery.get("project") || "";
  const shouldCreateTask = routeQuery.get("create") === "1";
  useEffect(() => {
    setStatus("all");
    setPage(1);
  }, [mode]);
  useEffect(() => {
    if (mode === "tasks" && requestedProject) {
      setTaskProject(requestedProject);
      setCreateOpen(shouldCreateTask);
    }
  }, [mode, requestedProject, shouldCreateTask]);
  const endpoint = isProjects
    ? "/api/projects/projects/"
    : "/api/projects/tasks/";
  const projectChoices = useApi<PageResult<Project>>(
    "/api/projects/projects/?page_size=100",
    token,
  );
  const query = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
  });
  if (search) query.set("search", search);
  if (status !== "all") query.set("status", status);
  if (!isProjects && requestedProject) query.set("project", requestedProject);
  if (mode === "mine") query.set("scope", "mine");
  if (mode === "team") query.set("scope", "team");
  const records = useApi<PageResult<Project | Task>>(
    `${endpoint}?${query}`,
    token,
  );
  const title =
    mode === "overview"
      ? "Projects & Tasks"
      : isProjects
        ? "Projects"
        : mode === "mine"
          ? "My Tasks"
          : mode === "team"
            ? "Team Tasks"
            : "All Tasks";

  if (mode === "overview") {
    const counts = metrics.data?.counts;
    return (
      <ERPWorkspacePage
        title={title}
        description="Plan work, track delivery, and follow up across your active branch."
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Metric
            label="Active projects"
            value={counts?.active_projects}
            icon={BriefcaseBusiness}
          />
          <Metric
            label="Open tasks"
            value={counts?.open_tasks}
            icon={ClipboardList}
          />
          <Metric label="My tasks" value={counts?.my_tasks} icon={UserCheck} />
          <Metric
            label="Overdue tasks"
            value={counts?.overdue_tasks}
            icon={ClipboardList}
          />
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <Metric
            label="Blocked tasks"
            value={counts?.blocked_tasks}
            icon={ClipboardList}
          />
          <Metric
            label="Awaiting review"
            value={counts?.awaiting_review}
            icon={UserCheck}
          />
          <Metric
            label="Ticket-linked tasks"
            value={counts?.ticket_tasks}
            icon={BriefcaseBusiness}
          />
        </div>
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg border bg-card p-5">
            <h2 className="font-semibold">Recent task activity</h2>
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
          </div>
          <div className="rounded-lg border bg-card p-5">
            <h2 className="font-semibold">Upcoming deadlines</h2>
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
          </div>
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <div className="rounded-lg border bg-card p-6">
            <h2 className="font-semibold">Start work</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Create a project or assign a standalone task in your active
              branch.
            </p>
            <div className="mt-4 flex gap-2">
              <Link href="/projects">
                <Button variant="outline">View projects</Button>
              </Link>
              <Link href="/projects/tasks">
                <Button>View tasks</Button>
              </Link>
            </div>
          </div>
          <div className="rounded-lg border bg-card p-6">
            <h2 className="font-semibold">Review work</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Move blocked work, assigned-role tasks, and approval-ready records
              forward.
            </p>
            <div className="mt-4 flex gap-2">
              <Link href="/projects/team-tasks">
                <Button variant="outline">Team tasks</Button>
              </Link>
              <Link href="/projects/follow-ups">
                <Button variant="outline">Follow-ups</Button>
              </Link>
            </div>
          </div>
          <div className="rounded-lg border bg-card p-6">
            <h2 className="font-semibold">Workflow ready</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Tasks begin in Draft and can use the central approval engine when
              a tenant workflow is configured.
            </p>
            <div className="mt-4">
              <Link href="/workflows/approvals">
                <Button variant="outline">Workflow requests</Button>
              </Link>
            </div>
          </div>
        </div>
      </ERPWorkspacePage>
    );
  }

  const items = records.data?.results ?? [];
  return (
    <ERPWorkspacePage
      title={title}
      description={
        mode === "mine"
          ? "Tasks assigned to you in your active branch and role."
          : mode === "team"
            ? "Tasks assigned to your currently selected role in the active branch."
            : "Tenant and branch scoped work records."
      }
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 gap-2">
          <div className="relative max-w-md flex-1">
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
          </div>
          <Select
            value={status}
            onValueChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-36">
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
                  <SelectItem value="in_review">In review</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </>
              )}
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void exportRegister()}>
            <Download className="mr-2 h-4 w-4" />
            Export CSV
          </Button>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            New {isProjects ? "Project" : "Task"}
          </Button>
        </div>
      </div>
      <div className="overflow-hidden rounded-lg border bg-card">
        <table className="w-full text-sm">
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
                      : task.project_name || "Standalone"}
                  </td>
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
                      {label(currentStatus)}
                    </Badge>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!records.isLoading && !items.length && (
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New {isProjects ? "Project" : "Task"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              value={recordTitle}
              onChange={(event) => setRecordTitle(event.target.value)}
              placeholder={isProjects ? "Project name" : "Task title"}
            />
            <Textarea
              value={recordDescription}
              onChange={(event) => setRecordDescription(event.target.value)}
              placeholder={
                isProjects
                  ? "Describe the expected outcome"
                  : "Describe the expected deliverable"
              }
            />
            {isProjects && (
              <div className="grid gap-3 sm:grid-cols-3">
                <Select
                  value={projectPriority}
                  onValueChange={setProjectPriority}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low priority</SelectItem>
                    <SelectItem value="medium">Medium priority</SelectItem>
                    <SelectItem value="high">High priority</SelectItem>
                    <SelectItem value="critical">Critical priority</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  type="date"
                  value={projectStartDate}
                  onChange={(event) => setProjectStartDate(event.target.value)}
                />
                <Input
                  type="date"
                  value={projectTargetEndDate}
                  onChange={(event) =>
                    setProjectTargetEndDate(event.target.value)
                  }
                />
              </div>
            )}
            {!isProjects && (
              <>
                <Select value={taskProject} onValueChange={setTaskProject}>
                  <SelectTrigger>
                    <SelectValue placeholder="Link to project (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Standalone task</SelectItem>
                    {(projectChoices.data?.results ?? []).map((project) => (
                      <SelectItem key={project.id} value={String(project.id)}>
                        {project.code} · {project.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <Input
                    value={taskType}
                    onChange={(event) => setTaskType(event.target.value)}
                    placeholder="Task type"
                  />
                  <Select value={taskPriority} onValueChange={setTaskPriority}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="critical">Critical</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    type="date"
                    value={taskStartDate}
                    aria-label="Task start date"
                    onChange={(event) => setTaskStartDate(event.target.value)}
                  />
                  <Input
                    type="date"
                    value={taskDueDate}
                    min={taskStartDate || undefined}
                    aria-label="Task due date"
                    onChange={(event) => setTaskDueDate(event.target.value)}
                  />
                  <Input
                    type="number"
                    min="0"
                    step="0.25"
                    value={taskEstimatedHours}
                    aria-label="Estimated hours"
                    placeholder="Estimated hours"
                    onChange={(event) =>
                      setTaskEstimatedHours(event.target.value)
                    }
                  />
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!recordTitle.trim() || createRecord.isPending}
              onClick={() => createRecord.mutate()}
            >
              Create draft {isProjects ? "project" : "task"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ERPWorkspacePage>
  );
}
