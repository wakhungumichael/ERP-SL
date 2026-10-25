/* Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@/context/use-auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ERPWorkspacePage } from "@/components/erp/workspace/workspace-page";
import { useToast } from "@/hooks/use-toast";
import { apiErrorFromResponse } from "@/lib/api-errors";
import { RecordAuditTrail } from "@/components/audit/record-audit-trail";

type Project = {
  code: string;
  name: string;
  description: string;
  status: string;
  progress_percentage: number;
  branch_name: string;
  manager_name: string;
  owner_name: string;
  start_date: string | null;
  target_end_date: string | null;
  priority: string;
  workflow_stage: string;
  estimated_budget: string | null;
  actual_cost: string | null;
};
type Milestone = {
  id: number;
  name: string;
  description: string;
  due_date: string | null;
  status: string;
  progress_percentage: number;
};
type ProjectTask = {
  id: number;
  number: string;
  title: string;
  status: string;
  progress_percentage: number;
  assignee_name: string;
  due_date: string | null;
};
type Members = {
  members: Array<{
    id: number;
    user_name: string;
    branch_name: string;
    responsibility: string;
  }>;
  candidates: Array<{
    user_id: number;
    user_name: string;
    branch_id: number;
    branch_name: string;
  }>;
  branches: Array<{ id: number; name: string }>;
};
type WorkflowRequirement = {
  data: {
    required: boolean;
    can_forward: boolean;
    in_progress: boolean;
    current_stage: string | null;
    current_role: string | null;
  };
};
type WorkflowItem = {
  id: number;
  status: string;
  title: string;
  detail: string;
  assigned_group_name: string | null;
  acted_by_name: string | null;
  acted_at: string | null;
  created_at: string;
  metadata?: {
    workflow_history?: Array<{
      action: string;
      actor_name: string;
      comment?: string;
      at: string;
    }>;
  };
};
type ProjectDocument = {
  id: number;
  task?: number;
  task_number?: string;
  task_title?: string;
  source: "project" | "task";
  file: string;
  original_name: string;
  size_bytes: number;
  is_evidence: boolean;
  uploaded_by_name: string;
  created_at: string;
};

const date = (value?: string | null) =>
  value
    ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
        new Date(value),
      )
    : "Not set";
const dateTime = (value?: string | null) =>
  value
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "Not recorded";
function useApi<T>(path: string, token: string | null) {
  return useQuery<T>({
    queryKey: ["project-record", path],
    enabled: !!token,
    queryFn: async () => {
      const response = await fetch(path, {
        headers: { Authorization: `Token ${token}` },
      });
      if (!response.ok)
        throw await apiErrorFromResponse(
          response,
          "Project information could not be loaded.",
        );
      return response.json() as Promise<T>;
    },
  });
}

export default function ProjectDetail({ id }: { id: string }) {
  const { token } = useAuth();
  const { toast } = useToast();
  const client = useQueryClient();
  const projectPath = `/api/projects/projects/${id}/`;
  const milestonesPath = `${projectPath}milestones/`;
  const membersPath = `${projectPath}members/`;
  const workflowPath = `/api/platform/workflows/requirement/?module_slug=projects-tasks&entity_type=project&entity_id=${id}&trigger_event=submit`;
  const historyPath = `/api/platform/workflows/history/?module_slug=projects-tasks&entity_type=project&entity_id=${id}`;
  const documentsPath = `${projectPath}documents/`;
  const project = useApi<Project>(projectPath, token);
  const milestones = useApi<Milestone[]>(milestonesPath, token);
  const tasks = useApi<{ count: number; results: ProjectTask[] }>(
    `/api/projects/tasks/?project=${id}&page_size=100`,
    token,
  );
  const members = useApi<Members>(membersPath, token);
  const workflow = useApi<WorkflowRequirement>(workflowPath, token);
  const history = useApi<{ data: WorkflowItem[] }>(historyPath, token);
  const documents = useApi<ProjectDocument[]>(documentsPath, token);
  const [name, setName] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [description, setDescription] = useState("");
  const [memberUser, setMemberUser] = useState("");
  const [responsibility, setResponsibility] = useState("contributor");
  const [newBranch, setNewBranch] = useState("");
  const [closeStatus, setCloseStatus] = useState("");
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editStartDate, setEditStartDate] = useState("");
  const [editTargetEndDate, setEditTargetEndDate] = useState("");
  const [editPriority, setEditPriority] = useState("");
  const [editStatus, setEditStatus] = useState("");
  const [editEstimatedBudget, setEditEstimatedBudget] = useState("");
  const [editActualCost, setEditActualCost] = useState("");
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [documentEvidence, setDocumentEvidence] = useState(false);
  const [editingMilestone, setEditingMilestone] = useState<Milestone | null>(
    null,
  );
  const [milestoneName, setMilestoneName] = useState("");
  const [milestoneDescription, setMilestoneDescription] = useState("");
  const [milestoneDueDate, setMilestoneDueDate] = useState("");
  const [milestoneStatus, setMilestoneStatus] = useState("draft");
  const [milestoneProgress, setMilestoneProgress] = useState("0");
  const refresh = (...paths: string[]) =>
    paths.forEach(
      (path) =>
        void client.invalidateQueries({ queryKey: ["project-record", path] }),
    );
  const addMilestone = useMutation({
    mutationFn: async () => {
      const response = await fetch(milestonesPath, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Token ${token}`,
        },
        body: JSON.stringify({ name, due_date: dueDate || null, description }),
      });
      if (!response.ok)
        throw await apiErrorFromResponse(
          response,
          "Milestone could not be created.",
        );
      return response.json();
    },
    onSuccess: () => {
      setName("");
      setDueDate("");
      setDescription("");
      refresh(milestonesPath);
      toast({ title: "Milestone created" });
    },
    onError: (error: Error) =>
      toast({
        title: "Could not create milestone",
        description: error.message,
        variant: "destructive",
      }),
  });
  const completeMilestone = useMutation({
    mutationFn: async (milestoneId: number) => {
      const response = await fetch(
        `${milestonesPath}${milestoneId}/complete/`,
        { method: "POST", headers: { Authorization: `Token ${token}` } },
      );
      if (!response.ok)
        throw await apiErrorFromResponse(
          response,
          "Milestone could not be completed.",
        );
    },
    onSuccess: () => {
      refresh(milestonesPath);
      toast({ title: "Milestone completed" });
    },
    onError: (error: Error) =>
      toast({
        title: "Could not complete milestone",
        description: error.message,
        variant: "destructive",
      }),
  });
  const removeMilestone = useMutation({
    mutationFn: async (milestoneId: number) => {
      const response = await fetch(`${milestonesPath}${milestoneId}/`, {
        method: "DELETE",
        headers: { Authorization: `Token ${token}` },
      });
      if (!response.ok)
        throw await apiErrorFromResponse(
          response,
          "Milestone could not be removed.",
        );
    },
    onSuccess: () => {
      refresh(milestonesPath);
      toast({ title: "Milestone removed" });
    },
    onError: (error: Error) =>
      toast({
        title: "Could not remove milestone",
        description: error.message,
        variant: "destructive",
      }),
  });
  const updateMilestone = useMutation({
    mutationFn: async () => {
      if (!editingMilestone) return;
      const progress = Number(milestoneProgress);
      if (!milestoneName.trim()) throw new Error("Enter a milestone name.");
      if (!Number.isInteger(progress) || progress < 0 || progress > 100)
        throw new Error("Progress must be a whole number from 0 to 100.");
      const response = await fetch(`${milestonesPath}${editingMilestone.id}/`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Token ${token}`,
        },
        body: JSON.stringify({
          name: milestoneName,
          description: milestoneDescription,
          due_date: milestoneDueDate || null,
          status: milestoneStatus,
          progress_percentage: progress,
        }),
      });
      if (!response.ok)
        throw await apiErrorFromResponse(
          response,
          "Milestone could not be updated.",
        );
    },
    onSuccess: () => {
      setEditingMilestone(null);
      refresh(milestonesPath);
      toast({ title: "Milestone updated" });
    },
    onError: (error: Error) =>
      toast({
        title: "Could not update milestone",
        description: error.message,
        variant: "destructive",
      }),
  });
  const updateMembers = useMutation({
    mutationFn: async (payload: Record<string, string>) => {
      const response = await fetch(membersPath, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Token ${token}`,
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok)
        throw await apiErrorFromResponse(
          response,
          "Project membership could not be updated.",
        );
    },
    onSuccess: () => {
      setMemberUser("");
      setNewBranch("");
      refresh(membersPath, projectPath);
      toast({ title: "Project members updated" });
    },
    onError: (error: Error) =>
      toast({
        title: "Could not update project members",
        description: error.message,
        variant: "destructive",
      }),
  });
  const removeMember = useMutation({
    mutationFn: async (memberId: number) => {
      const response = await fetch(`${membersPath}${memberId}/`, {
        method: "DELETE",
        headers: { Authorization: `Token ${token}` },
      });
      if (!response.ok)
        throw await apiErrorFromResponse(
          response,
          "Project member could not be removed.",
        );
    },
    onSuccess: () => {
      refresh(membersPath, projectPath);
      toast({ title: "Project member removed" });
    },
    onError: (error: Error) =>
      toast({
        title: "Could not remove project member",
        description: error.message,
        variant: "destructive",
      }),
  });
  const forward = useMutation({
    mutationFn: async () => {
      const record = project.data;
      const response = await fetch("/api/platform/workflows/forward/", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Token ${token}`,
        },
        body: JSON.stringify({
          module_slug: "projects-tasks",
          entity_type: "project",
          entity_id: Number(id),
          trigger_event: "submit",
          reference: record?.code,
          title: `Project approval: ${record?.name}`,
          detail: `Project ${record?.code} was forwarded for approval.`,
          metadata: { context: { priority: record?.priority } },
        }),
      });
      if (!response.ok)
        throw await apiErrorFromResponse(
          response,
          "Project could not be forwarded for approval.",
        );
    },
    onSuccess: () => {
      refresh(projectPath, workflowPath, historyPath);
      toast({ title: "Project forwarded for approval" });
    },
    onError: (error: Error) =>
      toast({
        title: "Could not forward project",
        description: error.message,
        variant: "destructive",
      }),
  });
  const closeProject = useMutation({
    mutationFn: async () => {
      const response = await fetch(`${projectPath}close/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Token ${token}`,
        },
        body: JSON.stringify({ status: closeStatus }),
      });
      if (!response.ok)
        throw await apiErrorFromResponse(
          response,
          "Project lifecycle could not be updated.",
        );
    },
    onSuccess: () => {
      setCloseStatus("");
      refresh(projectPath);
      toast({ title: "Project lifecycle updated" });
    },
    onError: (error: Error) =>
      toast({
        title: "Could not update project lifecycle",
        description: error.message,
        variant: "destructive",
      }),
  });
  const savePlanning = useMutation({
    mutationFn: async () => {
      const record = project.data;
      const payload: Record<string, string | null> = {
        name: editName || record?.name || "",
        description: editDescription || record?.description || "",
        start_date: editStartDate || record?.start_date || null,
        target_end_date: editTargetEndDate || record?.target_end_date || null,
        priority: editPriority || record?.priority || "medium",
        estimated_budget:
          editEstimatedBudget || record?.estimated_budget || null,
        actual_cost: editActualCost || record?.actual_cost || null,
      };
      if (editStatus) payload.status = editStatus;
      const response = await fetch(projectPath, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Token ${token}`,
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok)
        throw await apiErrorFromResponse(
          response,
          "Project planning changes could not be saved.",
        );
    },
    onSuccess: () => {
      refresh(projectPath);
      toast({ title: "Project planning updated" });
    },
    onError: (error: Error) =>
      toast({
        title: "Could not update project planning",
        description: error.message,
        variant: "destructive",
      }),
  });
  const uploadDocument = useMutation({
    mutationFn: async () => {
      if (!documentFile) throw new Error("Choose a file to upload.");
      const payload = new FormData();
      payload.append("file", documentFile);
      payload.append("is_evidence", String(documentEvidence));
      const response = await fetch(documentsPath, {
        method: "POST",
        headers: { Authorization: `Token ${token}` },
        body: payload,
      });
      if (!response.ok)
        throw await apiErrorFromResponse(
          response,
          "Project document could not be uploaded.",
        );
    },
    onSuccess: () => {
      setDocumentFile(null);
      setDocumentEvidence(false);
      refresh(documentsPath);
      toast({ title: "Project document uploaded" });
    },
    onError: (error: Error) =>
      toast({
        title: "Could not upload project document",
        description: error.message,
        variant: "destructive",
      }),
  });
  const removeDocument = useMutation({
    mutationFn: async (documentId: number) => {
      const response = await fetch(`${documentsPath}${documentId}/`, {
        method: "DELETE",
        headers: { Authorization: `Token ${token}` },
      });
      if (!response.ok)
        throw await apiErrorFromResponse(
          response,
          "Project document could not be removed.",
        );
    },
    onSuccess: () => {
      refresh(documentsPath);
      toast({ title: "Project document removed" });
    },
    onError: (error: Error) =>
      toast({
        title: "Could not remove project document",
        description: error.message,
        variant: "destructive",
      }),
  });
  const record = project.data;
  const projectTasks = tasks.data?.results ?? [];
  const workflowItems = history.data?.data ?? [];
  return (
    <ERPWorkspacePage
      title={record ? `${record.code} - ${record.name}` : "Project"}
      description="Plan, deliver, and govern project work from one branch-aware workspace."
    >
      {!record ? (
        <div className="rounded border bg-card p-8 text-sm text-muted-foreground">
          Loading project...
        </div>
      ) : (
        <>
          <div className="mb-3 flex justify-end">
            <RecordAuditTrail modelLabel="SL_Projects.Project" objectPk={id} />
          </div>
          <section className="mb-5 grid gap-4 lg:grid-cols-[1fr_auto]">
            <div className="rounded-lg border bg-card p-5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{record.status}</Badge>
                <Badge variant="outline">{record.priority}</Badge>
                <span className="text-sm text-muted-foreground">
                  {record.branch_name}
                </span>
              </div>
              <p className="mt-3 text-sm text-muted-foreground">
                {record.description || "No project description provided."}
              </p>
            </div>
            <div className="rounded-lg border bg-card p-5">
              <div className="text-3xl font-bold">
                {record.progress_percentage}%
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Delivery progress
              </p>
              <div className="mt-3 h-2 w-48 overflow-hidden rounded bg-muted">
                <div
                  className="h-full bg-[#C4B13B]"
                  style={{ width: `${record.progress_percentage}%` }}
                />
              </div>
            </div>
          </section>
          <Tabs defaultValue="overview">
            <TabsList className="h-auto w-full justify-start overflow-x-auto">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="tasks">
                Tasks ({tasks.data?.count ?? 0})
              </TabsTrigger>
              <TabsTrigger value="milestones">Milestones</TabsTrigger>
              <TabsTrigger value="team">Team</TabsTrigger>
              <TabsTrigger value="budget">Budget</TabsTrigger>
              <TabsTrigger value="documents">Documents</TabsTrigger>
              <TabsTrigger value="workflow">Workflow</TabsTrigger>
              <TabsTrigger value="activity">Activity</TabsTrigger>
            </TabsList>
            <TabsContent value="overview">
              <div className="grid gap-5 lg:grid-cols-3">
                <section className="rounded-lg border bg-card p-5 lg:col-span-2">
                  <h2 className="font-semibold">Project information</h2>
                  <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
                    <div>
                      <dt className="text-muted-foreground">Manager</dt>
                      <dd className="font-medium">
                        {record.manager_name || "Unassigned"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Owner</dt>
                      <dd className="font-medium">
                        {record.owner_name || "Unassigned"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Start date</dt>
                      <dd className="font-medium">{date(record.start_date)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Target end</dt>
                      <dd className="font-medium">
                        {date(record.target_end_date)}
                      </dd>
                    </div>
                  </dl>
                  <details className="mt-5 rounded border p-3">
                    <summary className="cursor-pointer font-medium">
                      Edit project planning
                    </summary>
                    <div className="mt-3 grid gap-3">
                      <Input
                        defaultValue={record.name}
                        onChange={(event) => setEditName(event.target.value)}
                        placeholder="Project name"
                      />
                      <Textarea
                        defaultValue={record.description}
                        onChange={(event) =>
                          setEditDescription(event.target.value)
                        }
                        placeholder="Project description"
                      />
                      <div className="grid gap-2 sm:grid-cols-2">
                        <Input
                          defaultValue={record.start_date || ""}
                          type="date"
                          onChange={(event) =>
                            setEditStartDate(event.target.value)
                          }
                        />
                        <Input
                          defaultValue={record.target_end_date || ""}
                          type="date"
                          onChange={(event) =>
                            setEditTargetEndDate(event.target.value)
                          }
                        />
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <Select
                          defaultValue={record.priority}
                          onValueChange={setEditPriority}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="low">Low priority</SelectItem>
                            <SelectItem value="medium">
                              Medium priority
                            </SelectItem>
                            <SelectItem value="high">High priority</SelectItem>
                            <SelectItem value="critical">
                              Critical priority
                            </SelectItem>
                          </SelectContent>
                        </Select>
                        <Select
                          defaultValue={record.status}
                          onValueChange={setEditStatus}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="draft">Draft</SelectItem>
                            <SelectItem value="planned">Planned</SelectItem>
                            <SelectItem value="active">Active</SelectItem>
                            <SelectItem value="on_hold">On hold</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <Button
                        className="w-fit"
                        disabled={savePlanning.isPending}
                        onClick={() => savePlanning.mutate()}
                      >
                        {savePlanning.isPending
                          ? "Saving..."
                          : "Save planning changes"}
                      </Button>
                    </div>
                  </details>
                </section>
                <aside className="rounded-lg border bg-card p-5">
                  <h2 className="font-semibold">Quick status</h2>
                  <dl className="mt-4 space-y-3 text-sm">
                    <div className="flex justify-between gap-4">
                      <dt className="text-muted-foreground">Tasks</dt>
                      <dd className="font-medium">
                        {
                          projectTasks.filter(
                            (task) => task.status === "completed",
                          ).length
                        }{" "}
                        / {tasks.data?.count ?? 0} completed
                      </dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-muted-foreground">Milestones</dt>
                      <dd className="font-medium">
                        {milestones.data?.length ?? 0}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Approval stage</dt>
                      <dd className="mt-1 font-medium">
                        {workflow.data?.data.current_stage
                          ? `${workflow.data.data.current_stage}${workflow.data.data.current_role ? ` · ${workflow.data.data.current_role}` : ""}`
                          : "Not in approval"}
                      </dd>
                    </div>
                  </dl>
                </aside>
              </div>
            </TabsContent>
            <TabsContent value="tasks">
              <section className="rounded-lg border bg-card p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="font-semibold">Project tasks</h2>
                    <p className="text-sm text-muted-foreground">
                      Open a task to update progress, evidence, follow-ups, and
                      assignments.
                    </p>
                  </div>
                  <Link href={`/projects/tasks?project=${id}`}>
                    <Button variant="outline">View all tasks</Button>
                  </Link>
                </div>
                <div className="mt-4 space-y-2">
                  {projectTasks.map((task) => (
                    <Link href={`/projects/tasks/${task.id}`} key={task.id}>
                      <div className="flex cursor-pointer flex-wrap items-center justify-between gap-3 rounded border p-3 text-sm hover:bg-muted/40">
                        <div>
                          <span className="font-mono text-xs text-muted-foreground">
                            {task.number}
                          </span>
                          <div className="font-medium">{task.title}</div>
                          <span className="text-muted-foreground">
                            {task.assignee_name || "Unassigned"} · Due{" "}
                            {date(task.due_date)}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span>{task.progress_percentage}%</span>
                          <Badge variant="outline">
                            {task.status.replaceAll("_", " ")}
                          </Badge>
                        </div>
                      </div>
                    </Link>
                  ))}
                  {!projectTasks.length && (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      No tasks have been added to this project yet.
                    </p>
                  )}
                </div>
              </section>
            </TabsContent>
            <TabsContent value="milestones">
              <section className="rounded-lg border bg-card p-5">
                <h2 className="font-semibold">Milestones</h2>
                <div className="mt-4 grid gap-2 md:grid-cols-[1fr_11rem_1fr_auto]">
                  <Input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Milestone name"
                  />
                  <Input
                    type="date"
                    value={dueDate}
                    onChange={(event) => setDueDate(event.target.value)}
                  />
                  <Textarea
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder="Outcome or dependency"
                  />
                  <Button
                    disabled={!name.trim() || addMilestone.isPending}
                    onClick={() => addMilestone.mutate()}
                  >
                    Add milestone
                  </Button>
                </div>
                <div className="mt-4 space-y-2">
                  {(milestones.data ?? []).map((milestone) => (
                    <div
                      className="flex flex-wrap items-center justify-between gap-3 rounded border p-3 text-sm"
                      key={milestone.id}
                    >
                      <div>
                        <div className="font-medium">{milestone.name}</div>
                        <div className="text-muted-foreground">
                          {milestone.description || "No description"}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-muted-foreground">
                          Due {date(milestone.due_date)}
                        </span>
                        <Badge variant="outline">{milestone.status}</Badge>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setEditingMilestone(milestone);
                            setMilestoneName(milestone.name);
                            setMilestoneDescription(milestone.description);
                            setMilestoneDueDate(milestone.due_date ?? "");
                            setMilestoneStatus(milestone.status);
                            setMilestoneProgress(
                              String(milestone.progress_percentage),
                            );
                          }}
                        >
                          Edit
                        </Button>
                        {milestone.status !== "completed" && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={completeMilestone.isPending}
                            onClick={() =>
                              completeMilestone.mutate(milestone.id)
                            }
                          >
                            Complete
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={removeMilestone.isPending}
                          onClick={() => {
                            if (
                              window.confirm(
                                `Remove milestone “${milestone.name}”?`,
                              )
                            )
                              removeMilestone.mutate(milestone.id);
                          }}
                        >
                          Remove
                        </Button>
                      </div>
                    </div>
                  ))}
                  {!milestones.data?.length && (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      No milestones have been added yet.
                    </p>
                  )}
                </div>
              </section>
            </TabsContent>
            <TabsContent value="team">
              <section className="rounded-lg border bg-card p-5">
                <h2 className="font-semibold">Project team and branches</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Enable participating branches, then allocate people and their
                  responsibility.
                </p>
                <div className="mt-4 grid gap-2 md:grid-cols-4">
                  <Select value={newBranch} onValueChange={setNewBranch}>
                    <SelectTrigger>
                      <SelectValue placeholder="Add participating branch" />
                    </SelectTrigger>
                    <SelectContent>
                      {(members.data?.branches ?? []).map((branch) => (
                        <SelectItem key={branch.id} value={String(branch.id)}>
                          {branch.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    disabled={!newBranch || updateMembers.isPending}
                    onClick={() =>
                      updateMembers.mutate({
                        action: "branch",
                        branch: newBranch,
                      })
                    }
                  >
                    Enable branch
                  </Button>
                  <Select value={memberUser} onValueChange={setMemberUser}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select member" />
                    </SelectTrigger>
                    <SelectContent>
                      {(members.data?.candidates ?? []).map((candidate) => (
                        <SelectItem
                          key={`${candidate.user_id}-${candidate.branch_id}`}
                          value={`${candidate.user_id}:${candidate.branch_id}`}
                        >
                          {candidate.user_name} · {candidate.branch_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={responsibility}
                    onValueChange={setResponsibility}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="manager">Manager</SelectItem>
                      <SelectItem value="owner">Owner</SelectItem>
                      <SelectItem value="contributor">Contributor</SelectItem>
                      <SelectItem value="viewer">Viewer</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  className="mt-2"
                  disabled={!memberUser || updateMembers.isPending}
                  onClick={() => {
                    const [user, branch] = memberUser.split(":");
                    updateMembers.mutate({ user, branch, responsibility });
                  }}
                >
                  Add project member
                </Button>
                <div className="mt-4 space-y-2">
                  {(members.data?.members ?? []).map((member) => (
                    <div
                      className="flex items-center justify-between gap-3 rounded border p-3 text-sm"
                      key={member.id}
                    >
                      <span className="font-medium">{member.user_name}</span>
                      <div className="flex items-center gap-3">
                        <span className="text-muted-foreground">
                          {member.responsibility} · {member.branch_name}
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={removeMember.isPending}
                          onClick={() => removeMember.mutate(member.id)}
                        >
                          Remove
                        </Button>
                      </div>
                    </div>
                  ))}
                  {!members.data?.members.length && (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      No project members assigned yet.
                    </p>
                  )}
                </div>
              </section>
            </TabsContent>
            <Dialog
              open={Boolean(editingMilestone)}
              onOpenChange={(open) => {
                if (!open) setEditingMilestone(null);
              }}
            >
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Edit milestone</DialogTitle>
                </DialogHeader>
                <div className="grid gap-3">
                  <Input
                    value={milestoneName}
                    onChange={(event) => setMilestoneName(event.target.value)}
                    placeholder="Milestone name"
                  />
                  <Textarea
                    value={milestoneDescription}
                    onChange={(event) =>
                      setMilestoneDescription(event.target.value)
                    }
                    placeholder="Outcome or dependency"
                  />
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Input
                      type="date"
                      value={milestoneDueDate}
                      onChange={(event) =>
                        setMilestoneDueDate(event.target.value)
                      }
                    />
                    <Select
                      value={milestoneStatus}
                      onValueChange={setMilestoneStatus}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="draft">Draft</SelectItem>
                        <SelectItem value="open">Open</SelectItem>
                        <SelectItem value="completed">Completed</SelectItem>
                        <SelectItem value="cancelled">Cancelled</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input
                      type="number"
                      min="0"
                      max="100"
                      value={milestoneProgress}
                      onChange={(event) =>
                        setMilestoneProgress(event.target.value)
                      }
                      placeholder="Progress %"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => setEditingMilestone(null)}
                  >
                    Cancel
                  </Button>
                  <Button
                    disabled={updateMilestone.isPending}
                    onClick={() => updateMilestone.mutate()}
                  >
                    {updateMilestone.isPending ? "Saving..." : "Save milestone"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <TabsContent value="budget">
              <section className="rounded-lg border bg-card p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="font-semibold">Project budget</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Track the approved estimate and actual cost for this
                      project.
                    </p>
                  </div>
                  <Badge variant="outline">
                    Variance:{" "}
                    {record.estimated_budget !== null &&
                    record.actual_cost !== null
                      ? (
                          Number(record.estimated_budget) -
                          Number(record.actual_cost)
                        ).toLocaleString()
                      : "Not calculated"}
                  </Badge>
                </div>
                <div className="mt-5 grid max-w-2xl gap-4 sm:grid-cols-2">
                  <label className="grid gap-2 text-sm font-medium">
                    Estimated budget
                    <Input
                      min="0"
                      step="0.01"
                      defaultValue={record.estimated_budget ?? ""}
                      onChange={(event) =>
                        setEditEstimatedBudget(event.target.value)
                      }
                      placeholder="0.00"
                      type="number"
                    />
                  </label>
                  <label className="grid gap-2 text-sm font-medium">
                    Actual cost
                    <Input
                      min="0"
                      step="0.01"
                      defaultValue={record.actual_cost ?? ""}
                      onChange={(event) =>
                        setEditActualCost(event.target.value)
                      }
                      placeholder="0.00"
                      type="number"
                    />
                  </label>
                </div>
                <Button
                  className="mt-4"
                  disabled={savePlanning.isPending}
                  onClick={() => savePlanning.mutate()}
                >
                  {savePlanning.isPending ? "Saving..." : "Save budget"}
                </Button>
              </section>
            </TabsContent>
            <TabsContent value="documents">
              <section className="rounded-lg border bg-card p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="font-semibold">Project documents</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Keep project documents here; supporting task files and
                      approval evidence are included below.
                    </p>
                  </div>
                  <span className="text-sm text-muted-foreground">
                    {documents.data?.length ?? 0} file(s)
                  </span>
                </div>
                <div className="mt-4 grid gap-2 rounded border bg-muted/20 p-3 md:grid-cols-[1fr_auto_auto]">
                  <Input
                    type="file"
                    onChange={(event) =>
                      setDocumentFile(event.target.files?.[0] ?? null)
                    }
                  />
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      checked={documentEvidence}
                      onChange={(event) =>
                        setDocumentEvidence(event.target.checked)
                      }
                      type="checkbox"
                    />{" "}
                    Approval evidence
                  </label>
                  <Button
                    disabled={!documentFile || uploadDocument.isPending}
                    onClick={() => uploadDocument.mutate()}
                  >
                    {uploadDocument.isPending
                      ? "Uploading..."
                      : "Upload document"}
                  </Button>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Maximum file size: 10 MB. Project documents are retained in
                  the project audit trail.
                </p>
                <div className="mt-4 space-y-2">
                  {(documents.data ?? []).map((file) => (
                    <div
                      className="flex flex-wrap items-center justify-between gap-3 rounded border p-3 text-sm hover:bg-muted/40"
                      key={`${file.source}-${file.id}`}
                    >
                      <a href={file.file} rel="noreferrer" target="_blank">
                        <div className="font-medium">
                          {file.original_name}
                          {file.is_evidence ? " · Approval evidence" : ""}
                        </div>
                        <p className="text-muted-foreground">
                          {file.source === "project"
                            ? "Project document"
                            : `${file.task_number} · ${file.task_title}`}{" "}
                          · {file.uploaded_by_name}
                        </p>
                      </a>
                      <div className="flex items-center gap-3">
                        <span className="text-muted-foreground">
                          {dateTime(file.created_at)}
                        </span>
                        {file.source === "project" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={removeDocument.isPending}
                            onClick={() => {
                              if (
                                window.confirm(
                                  `Remove “${file.original_name}”?`,
                                )
                              )
                                removeDocument.mutate(file.id);
                            }}
                          >
                            Remove
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                  {!documents.data?.length && (
                    <p className="rounded border border-dashed py-8 text-center text-sm text-muted-foreground">
                      No documents have been added to this project yet.
                    </p>
                  )}
                </div>
              </section>
            </TabsContent>
            <TabsContent value="workflow">
              <div className="grid gap-5 lg:grid-cols-3">
                <section className="rounded-lg border bg-card p-5 lg:col-span-2">
                  <h2 className="font-semibold">Approval history</h2>
                  <div className="mt-4 space-y-3">
                    {workflowItems.map((item) => (
                      <div className="rounded border p-3 text-sm" key={item.id}>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="font-medium">{item.title}</div>
                          <Badge variant="outline">{item.status}</Badge>
                        </div>
                        <p className="mt-1 text-muted-foreground">
                          {item.detail}
                        </p>
                        <p className="mt-2 text-xs text-muted-foreground">
                          Assigned to{" "}
                          {item.assigned_group_name || "an approver"} ·{" "}
                          {dateTime(item.created_at)}
                        </p>
                        {(item.metadata?.workflow_history ?? []).map(
                          (event, index) => (
                            <div
                              className="mt-2 border-l-2 pl-3 text-xs text-muted-foreground"
                              key={`${item.id}-${index}`}
                            >
                              <span className="font-medium text-foreground">
                                {event.action}
                              </span>{" "}
                              by {event.actor_name} · {dateTime(event.at)}
                              {event.comment ? ` — ${event.comment}` : ""}
                            </div>
                          ),
                        )}
                      </div>
                    ))}
                    {!workflowItems.length && (
                      <p className="py-8 text-center text-sm text-muted-foreground">
                        This project has not entered a workflow yet.
                      </p>
                    )}
                  </div>
                </section>
                <aside className="rounded-lg border bg-card p-5">
                  <h2 className="font-semibold">Workflow control</h2>
                  <p className="mt-3 text-sm text-muted-foreground">
                    {workflow.data?.data.required
                      ? "A published workflow applies to this project."
                      : "No published workflow is configured for this project type."}
                  </p>
                  {workflow.data?.data.required &&
                    !workflow.data.data.in_progress &&
                    workflow.data.data.can_forward && (
                      <Button
                        className="mt-4 w-full"
                        disabled={forward.isPending}
                        onClick={() => forward.mutate()}
                      >
                        {forward.isPending
                          ? "Forwarding..."
                          : "Forward for approval"}
                      </Button>
                    )}
                  {workflow.data?.data.in_progress && (
                    <p className="mt-4 text-sm text-muted-foreground">
                      Currently at {workflow.data.data.current_stage}
                      {workflow.data.data.current_role
                        ? ` · ${workflow.data.data.current_role}`
                        : ""}
                    </p>
                  )}
                </aside>
              </div>
            </TabsContent>
            <TabsContent value="activity">
              <section className="rounded-lg border bg-card p-5">
                <h2 className="font-semibold">Project lifecycle</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Close a project only once all required work has been
                  completed. Project decisions remain available in workflow
                  history.
                </p>
                <div className="mt-4 flex max-w-lg flex-wrap gap-2">
                  <Select value={closeStatus} onValueChange={setCloseStatus}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose lifecycle action" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="completed">
                        Complete project
                      </SelectItem>
                      <SelectItem value="cancelled">Cancel project</SelectItem>
                      <SelectItem value="archived">Archive project</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    disabled={!closeStatus || closeProject.isPending}
                    onClick={() => closeProject.mutate()}
                  >
                    {closeProject.isPending ? "Updating..." : "Apply action"}
                  </Button>
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  Completion is allowed only after all project tasks are closed.
                </p>
              </section>
            </TabsContent>
          </Tabs>
        </>
      )}
    </ERPWorkspacePage>
  );
}
