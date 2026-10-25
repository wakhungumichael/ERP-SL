/* Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@/context/use-auth";
import { ERPWorkspacePage } from "@/components/erp/workspace/workspace-page";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiErrorFromResponse } from "@/lib/api-errors";
import { RecordAuditTrail } from "@/components/audit/record-audit-trail";

type Task = {
  number: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  progress_percentage: number;
  project_name: string;
  branch_name: string;
  assignee_name: string;
  task_type: string;
  start_date: string | null;
  due_date: string | null;
  workflow_stage: string;
  assigned_role: number | null;
  estimated_hours: string | null;
  actual_hours: string | null;
};
type Update = {
  id: number;
  progress_percentage: number;
  update_description: string;
  time_spent_hours: string;
  created_at: string;
};
type FollowUp = {
  id: number;
  follow_up_date: string;
  notes: string;
  status: string;
  owner_name: string;
};
type Comment = {
  id: number;
  body: string;
  author_name: string;
  created_at: string;
};
type Attachment = {
  id: number;
  file: string;
  original_name: string;
  size_bytes: number;
  is_evidence: boolean;
  uploaded_by_name: string;
  created_at: string;
};
type Assignee = { id: number; name: string };
type Structure = {
  subtasks: Array<{
    id: number;
    number: string;
    title: string;
    status: string;
  }>;
  dependencies: Array<{
    id: number;
    number: string;
    title: string;
    status: string;
  }>;
  candidates: Array<{ id: number; number: string; title: string }>;
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

function useProjectApi<T>(path: string, token: string | null) {
  return useQuery<T>({
    queryKey: ["project-detail", path],
    enabled: !!token,
    queryFn: async () => {
      const response = await fetch(path, {
        headers: { Authorization: `Token ${token}` },
      });
      if (!response.ok)
        throw await apiErrorFromResponse(
          response,
          "Task details could not be loaded.",
        );
      return response.json() as Promise<T>;
    },
  });
}

function formatDate(value?: string | null) {
  return value
    ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
        new Date(value),
      )
    : "Not set";
}
function formatDateTime(value?: string | null) {
  return value
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "Not recorded";
}

export default function TaskDetail({ id }: { id: string }) {
  const { token } = useAuth();
  const { toast } = useToast();
  const client = useQueryClient();
  const taskPath = `/api/projects/tasks/${id}/`;
  const updatesPath = `${taskPath}updates/`;
  const followUpsPath = `${taskPath}follow-ups/`;
  const commentsPath = `${taskPath}comments/`;
  const attachmentsPath = `${taskPath}attachments/`;
  const assigneesPath = `${taskPath}assignees/`;
  const rolesPath = `${taskPath}roles/`;
  const structurePath = `${taskPath}structure/`;
  const task = useProjectApi<Task>(taskPath, token);
  const updates = useProjectApi<Update[]>(updatesPath, token);
  const followUps = useProjectApi<FollowUp[]>(followUpsPath, token);
  const comments = useProjectApi<Comment[]>(commentsPath, token);
  const attachments = useProjectApi<Attachment[]>(attachmentsPath, token);
  const assignees = useProjectApi<Assignee[]>(assigneesPath, token);
  const roles = useProjectApi<Assignee[]>(rolesPath, token);
  const structure = useProjectApi<Structure>(structurePath, token);
  const workflow = useProjectApi<WorkflowRequirement>(
    `/api/platform/workflows/requirement/?module_slug=projects-tasks&entity_type=project_task&entity_id=${id}&trigger_event=submit`,
    token,
  );
  const historyPath = `/api/platform/workflows/history/?module_slug=projects-tasks&entity_type=project_task&entity_id=${id}`;
  const workflowHistory = useProjectApi<{ data: WorkflowItem[] }>(
    historyPath,
    token,
  );
  const [progress, setProgress] = useState("");
  const [note, setNote] = useState("");
  const [timeSpent, setTimeSpent] = useState("");
  const [followUpDate, setFollowUpDate] = useState("");
  const [followUpNotes, setFollowUpNotes] = useState("");
  const [comment, setComment] = useState("");
  const [attachment, setAttachment] = useState<File | null>(null);
  const [isEvidence, setIsEvidence] = useState(false);
  const [assigneeId, setAssigneeId] = useState("");
  const [subtaskTitle, setSubtaskTitle] = useState("");
  const [subtaskDescription, setSubtaskDescription] = useState("");
  const [subtaskDueDate, setSubtaskDueDate] = useState("");
  const [subtaskPriority, setSubtaskPriority] = useState("medium");
  const [subtaskEstimatedHours, setSubtaskEstimatedHours] = useState("");
  const [subtaskOpen, setSubtaskOpen] = useState(false);
  const [roleAssignmentOpen, setRoleAssignmentOpen] = useState(false);
  const [assignedRoleId, setAssignedRoleId] = useState("none");
  useEffect(() => {
    setAssignedRoleId(
      task.data?.assigned_role ? String(task.data.assigned_role) : "none",
    );
  }, [task.data?.assigned_role]);
  const [dependencyId, setDependencyId] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editTaskType, setEditTaskType] = useState("");
  const [editStartDate, setEditStartDate] = useState("");
  const [editDueDate, setEditDueDate] = useState("");
  const [editEstimatedHours, setEditEstimatedHours] = useState("");
  const [editPriority, setEditPriority] = useState("");
  const [editStatus, setEditStatus] = useState("");
  useEffect(() => {
    if (!task.data) return;
    setEditTitle(task.data.title);
    setEditDescription(task.data.description || "");
    setEditTaskType(task.data.task_type || "");
    setEditStartDate(task.data.start_date || "");
    setEditDueDate(task.data.due_date || "");
    setEditEstimatedHours(task.data.estimated_hours || "");
    setEditPriority(task.data.priority);
    setEditStatus(task.data.status);
  }, [task.data?.number]);
  const refresh = (paths: string[]) =>
    paths.forEach(
      (path) =>
        void client.invalidateQueries({ queryKey: ["project-detail", path] }),
    );
  const addUpdate = useMutation({
    mutationFn: async () => {
      const value = Number(progress);
      if (!Number.isInteger(value) || value < 0 || value > 100)
        throw new Error("Progress must be a whole number between 0 and 100.");
      const hours = Number(timeSpent || 0);
      if (!Number.isFinite(hours) || hours < 0)
        throw new Error("Hours worked must be zero or more.");
      const response = await fetch(updatesPath, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Token ${token}`,
        },
        body: JSON.stringify({
          progress_percentage: value,
          update_description: note,
          time_spent_hours: hours,
        }),
      });
      if (!response.ok)
        throw await apiErrorFromResponse(
          response,
          "Progress update could not be saved.",
        );
      return response.json();
    },
    onSuccess: () => {
      setProgress("");
      setNote("");
      setTimeSpent("");
      refresh([taskPath, updatesPath]);
      toast({ title: "Progress update saved" });
    },
    onError: (error: Error) =>
      toast({
        title: "Could not save progress update",
        description: error.message,
        variant: "destructive",
      }),
  });
  const addFollowUp = useMutation({
    mutationFn: async () => {
      const response = await fetch(followUpsPath, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Token ${token}`,
        },
        body: JSON.stringify({
          follow_up_date: followUpDate,
          notes: followUpNotes,
        }),
      });
      if (!response.ok)
        throw await apiErrorFromResponse(
          response,
          "Follow-up could not be scheduled.",
        );
      return response.json();
    },
    onSuccess: () => {
      setFollowUpDate("");
      setFollowUpNotes("");
      refresh([followUpsPath]);
      toast({ title: "Follow-up scheduled" });
    },
    onError: (error: Error) =>
      toast({
        title: "Could not schedule follow-up",
        description: error.message,
        variant: "destructive",
      }),
  });
  const completeFollowUp = useMutation({
    mutationFn: async (followUpId: number) => {
      const response = await fetch(`${followUpsPath}${followUpId}/complete/`, {
        method: "POST",
        headers: { Authorization: `Token ${token}` },
      });
      if (!response.ok)
        throw await apiErrorFromResponse(
          response,
          "Follow-up could not be completed.",
        );
      return response.json();
    },
    onSuccess: () => {
      refresh([followUpsPath]);
      toast({ title: "Follow-up completed" });
    },
    onError: (error: Error) =>
      toast({
        title: "Could not complete follow-up",
        description: error.message,
        variant: "destructive",
      }),
  });
  const addComment = useMutation({
    mutationFn: async () => {
      const response = await fetch(commentsPath, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Token ${token}`,
        },
        body: JSON.stringify({ body: comment }),
      });
      if (!response.ok)
        throw await apiErrorFromResponse(
          response,
          "Comment could not be saved.",
        );
      return response.json();
    },
    onSuccess: () => {
      setComment("");
      refresh([commentsPath]);
      toast({ title: "Comment added" });
    },
    onError: (error: Error) =>
      toast({
        title: "Could not add comment",
        description: error.message,
        variant: "destructive",
      }),
  });
  const uploadAttachment = useMutation({
    mutationFn: async () => {
      if (!attachment) throw new Error("Choose a file first.");
      const body = new FormData();
      body.append("file", attachment);
      body.append("is_evidence", String(isEvidence));
      const response = await fetch(attachmentsPath, {
        method: "POST",
        headers: { Authorization: `Token ${token}` },
        body,
      });
      if (!response.ok)
        throw await apiErrorFromResponse(
          response,
          "Attachment could not be uploaded.",
        );
      return response.json();
    },
    onSuccess: () => {
      setAttachment(null);
      setIsEvidence(false);
      refresh([attachmentsPath]);
      toast({ title: "Attachment uploaded" });
    },
    onError: (error: Error) =>
      toast({
        title: "Could not upload attachment",
        description: error.message,
        variant: "destructive",
      }),
  });
  const removeAttachment = useMutation({
    mutationFn: async (attachmentId: number) => {
      const response = await fetch(`${attachmentsPath}${attachmentId}/`, {
        method: "DELETE",
        headers: { Authorization: `Token ${token}` },
      });
      if (!response.ok)
        throw await apiErrorFromResponse(
          response,
          "Attachment could not be removed.",
        );
    },
    onSuccess: () => {
      refresh([attachmentsPath]);
      toast({ title: "Attachment removed" });
    },
    onError: (error: Error) =>
      toast({
        title: "Could not remove attachment",
        description: error.message,
        variant: "destructive",
      }),
  });
  const assign = useMutation({
    mutationFn: async () => {
      const response = await fetch(`${taskPath}assign/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Token ${token}`,
        },
        body: JSON.stringify({
          primary_assignee:
            assigneeId === "unassigned" ? null : assigneeId || null,
        }),
      });
      if (!response.ok)
        throw await apiErrorFromResponse(
          response,
          "Task assignment could not be saved.",
        );
      return response.json();
    },
    onSuccess: () => {
      refresh([taskPath]);
      toast({ title: "Task assignment updated" });
    },
    onError: (error: Error) =>
      toast({
        title: "Could not update assignment",
        description: error.message,
        variant: "destructive",
      }),
  });
  const assignRole = useMutation({
    mutationFn: async () => {
      const response = await fetch(`${taskPath}assign/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Token ${token}`,
        },
        body: JSON.stringify({
          assigned_role:
            assignedRoleId === "none" ? null : Number(assignedRoleId),
        }),
      });
      if (!response.ok)
        throw await apiErrorFromResponse(
          response,
          "Task role could not be saved.",
        );
      return response.json();
    },
    onSuccess: () => {
      setRoleAssignmentOpen(false);
      refresh([taskPath]);
      toast({ title: "Task role assignment updated" });
    },
    onError: (error: Error) =>
      toast({
        title: "Could not update task role",
        description: error.message,
        variant: "destructive",
      }),
  });
  const addStructure = useMutation({
    mutationFn: async (payload: Record<string, string>) => {
      const response = await fetch(structurePath, {
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
          "Task structure could not be updated.",
        );
      return response.json();
    },
    onSuccess: () => {
      setSubtaskTitle("");
      setSubtaskDescription("");
      setSubtaskDueDate("");
      setSubtaskPriority("medium");
      setSubtaskEstimatedHours("");
      setSubtaskOpen(false);
      setDependencyId("");
      refresh([structurePath]);
      toast({ title: "Task structure updated" });
    },
    onError: (error: Error) =>
      toast({
        title: "Could not update task structure",
        description: error.message,
        variant: "destructive",
      }),
  });
  const saveTask = useMutation({
    mutationFn: async () => {
      if (!editTitle.trim()) throw new Error("Enter a task title.");
      if (editStartDate && editDueDate && editDueDate < editStartDate) {
        throw new Error("Due date cannot be before the task start date.");
      }
      if (
        editEstimatedHours &&
        (!Number.isFinite(Number(editEstimatedHours)) ||
          Number(editEstimatedHours) < 0)
      ) {
        throw new Error("Estimated hours must be zero or more.");
      }
      const response = await fetch(taskPath, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Token ${token}`,
        },
        body: JSON.stringify({
          title: editTitle.trim(),
          description: editDescription,
          task_type: editTaskType,
          start_date: editStartDate || null,
          due_date: editDueDate || null,
          estimated_hours: editEstimatedHours || null,
          priority: editPriority,
          status: editStatus,
        }),
      });
      if (!response.ok)
        throw await apiErrorFromResponse(
          response,
          "Task changes could not be saved.",
        );
      return response.json();
    },
    onSuccess: () => {
      refresh([taskPath]);
      toast({ title: "Task details updated" });
    },
    onError: (error: Error) =>
      toast({
        title: "Could not update task",
        description: error.message,
        variant: "destructive",
      }),
  });
  const forward = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/platform/workflows/forward/", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Token ${token}`,
        },
        body: JSON.stringify({
          module_slug: "projects-tasks",
          entity_type: "project_task",
          entity_id: Number(id),
          trigger_event: "submit",
          reference: task.data?.number,
          title: `Task approval: ${task.data?.title}`,
          detail: `Task ${task.data?.number} was forwarded for approval.`,
          metadata: { context: { priority: task.data?.priority } },
        }),
      });
      if (!response.ok)
        throw await apiErrorFromResponse(
          response,
          "Task could not be forwarded for approval.",
        );
      return response.json();
    },
    onSuccess: () => {
      refresh([
        taskPath,
        `/api/platform/workflows/requirement/?module_slug=projects-tasks&entity_type=project_task&entity_id=${id}&trigger_event=submit`,
        historyPath,
      ]);
      toast({ title: "Task forwarded for approval" });
    },
    onError: (error: Error) =>
      toast({
        title: "Could not forward task",
        description: error.message,
        variant: "destructive",
      }),
  });
  const record = task.data;
  return (
    <ERPWorkspacePage
      title={record ? `${record.number} - ${record.title}` : "Task"}
      description="Assignment, progress, follow-ups, and discussion for this task."
    >
      {record && (
        <div className="mb-4 flex flex-wrap justify-end gap-2">
          <RecordAuditTrail
            modelLabel="SL_Projects.ProjectTask"
            objectPk={id}
          />
          <Button variant="outline" onClick={() => setRoleAssignmentOpen(true)}>
            Assign team role
          </Button>
          <Button onClick={() => setSubtaskOpen(true)}>Create subtask</Button>
        </div>
      )}
      <Dialog open={subtaskOpen} onOpenChange={setSubtaskOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create subtask</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Input
              autoFocus
              value={subtaskTitle}
              onChange={(event) => setSubtaskTitle(event.target.value)}
              placeholder="Subtask title"
            />
            <Textarea
              value={subtaskDescription}
              onChange={(event) => setSubtaskDescription(event.target.value)}
              placeholder="Describe the deliverable or acceptance criteria"
            />
            <div className="grid gap-2 sm:grid-cols-3">
              <Input
                type="date"
                value={subtaskDueDate}
                aria-label="Subtask due date"
                onChange={(event) => setSubtaskDueDate(event.target.value)}
              />
              <Select
                value={subtaskPriority}
                onValueChange={setSubtaskPriority}
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
                type="number"
                min="0"
                step="0.25"
                value={subtaskEstimatedHours}
                aria-label="Subtask estimated hours"
                placeholder="Estimated hours"
                onChange={(event) =>
                  setSubtaskEstimatedHours(event.target.value)
                }
              />
            </div>
            <p className="text-sm text-muted-foreground">
              The subtask inherits this task’s project and branch. Set planning
              details now or refine it from the new task record.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSubtaskOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!subtaskTitle.trim() || addStructure.isPending}
              onClick={() => {
                const hours = Number(subtaskEstimatedHours || 0);
                if (!Number.isFinite(hours) || hours < 0) {
                  toast({
                    title: "Estimated hours must be zero or more.",
                    variant: "destructive",
                  });
                  return;
                }
                addStructure.mutate({
                  action: "subtask",
                  title: subtaskTitle,
                  description: subtaskDescription,
                  due_date: subtaskDueDate,
                  priority: subtaskPriority,
                  estimated_hours: subtaskEstimatedHours,
                });
              }}
            >
              {addStructure.isPending ? "Creating..." : "Create subtask"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={roleAssignmentOpen} onOpenChange={setRoleAssignmentOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign team role</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Select value={assignedRoleId} onValueChange={setAssignedRoleId}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a branch role" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No team role</SelectItem>
                {(roles.data ?? []).map((role) => (
                  <SelectItem key={role.id} value={String(role.id)}>
                    {role.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-sm text-muted-foreground">
              Only active roles configured for this task’s branch can be
              selected. The selected role will see this work in Team Tasks.
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRoleAssignmentOpen(false)}
            >
              Cancel
            </Button>
            <Button
              disabled={assignRole.isPending}
              onClick={() => assignRole.mutate()}
            >
              {assignRole.isPending ? "Saving..." : "Save team role"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {!record ? (
        <div className="rounded-lg border bg-card p-8 text-sm text-muted-foreground">
          Loading task details...
        </div>
      ) : (
        <Tabs defaultValue="overview">
          <TabsList className="h-auto w-full justify-start overflow-x-auto">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="activity">Activity & follow-ups</TabsTrigger>
            <TabsTrigger value="discussion">Discussion & files</TabsTrigger>
            <TabsTrigger value="structure">Subtasks & dependencies</TabsTrigger>
            <TabsTrigger value="workflow">Workflow history</TabsTrigger>
          </TabsList>
          <TabsContent value="overview">
            <div className="grid gap-5 lg:grid-cols-3">
              <section className="rounded-lg border bg-card p-5 lg:col-span-2">
                <h2 className="font-semibold">Task Summary</h2>
                <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">
                  {record.description || "No task description provided."}
                </p>
                <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-muted-foreground">Project</dt>
                    <dd className="font-medium">
                      {record.project_name || "Standalone task"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Assigned to</dt>
                    <dd className="font-medium">
                      {record.assignee_name || "Unassigned"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Branch</dt>
                    <dd className="font-medium">{record.branch_name}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Start date</dt>
                    <dd className="font-medium">
                      {formatDate(record.start_date)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Due date</dt>
                    <dd className="font-medium">
                      {formatDate(record.due_date)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Hours</dt>
                    <dd className="font-medium">
                      {record.actual_hours || "0"} actual /{" "}
                      {record.estimated_hours || "—"} estimated
                    </dd>
                  </div>
                </dl>
                <details className="mt-5 rounded border p-3">
                  <summary className="cursor-pointer font-medium">
                    Edit task planning
                  </summary>
                  <div className="mt-3 grid gap-3">
                    <Input
                      value={editTitle}
                      onChange={(event) => setEditTitle(event.target.value)}
                      placeholder="Task title"
                    />
                    <Textarea
                      value={editDescription}
                      onChange={(event) =>
                        setEditDescription(event.target.value)
                      }
                      placeholder="Task description"
                    />
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Input
                        value={editTaskType}
                        onChange={(event) =>
                          setEditTaskType(event.target.value)
                        }
                        placeholder="Task type"
                      />
                      <Input
                        value={editEstimatedHours}
                        min="0"
                        step="0.25"
                        type="number"
                        onChange={(event) =>
                          setEditEstimatedHours(event.target.value)
                        }
                        placeholder="Estimated hours"
                      />
                      <Input
                        value={editStartDate}
                        type="date"
                        onChange={(event) =>
                          setEditStartDate(event.target.value)
                        }
                      />
                      <Input
                        value={editDueDate}
                        min={editStartDate || undefined}
                        type="date"
                        onChange={(event) => setEditDueDate(event.target.value)}
                      />
                      <Select
                        value={editPriority}
                        onValueChange={setEditPriority}
                      >
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
                      <Select value={editStatus} onValueChange={setEditStatus}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="draft">Draft</SelectItem>
                          <SelectItem value="todo">To do</SelectItem>
                          <SelectItem value="in_progress">
                            In progress
                          </SelectItem>
                          <SelectItem value="blocked">Blocked</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <Button
                      className="w-fit"
                      disabled={saveTask.isPending}
                      onClick={() => saveTask.mutate()}
                    >
                      {saveTask.isPending ? "Saving..." : "Save task details"}
                    </Button>
                  </div>
                </details>
              </section>
              <aside className="rounded-lg border bg-card p-5">
                <h2 className="font-semibold">Current State</h2>
                <Badge className="mt-3" variant="outline">
                  {record.status.replaceAll("_", " ")}
                </Badge>
                <div className="mt-5 text-3xl font-bold">
                  {record.progress_percentage}%
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {workflow.data?.data.current_stage
                    ? `Approval stage: ${workflow.data.data.current_stage}${workflow.data.data.current_role ? ` - ${workflow.data.data.current_role}` : ""}`
                    : record.workflow_stage
                      ? `Approval stage: ${record.workflow_stage}`
                      : "No approval stage active."}
                </p>
                <div className="mt-4 space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">
                    Assign task
                  </p>
                  <Select value={assigneeId} onValueChange={setAssigneeId}>
                    <SelectTrigger>
                      <SelectValue
                        placeholder={record.assignee_name || "Unassigned"}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unassigned">Unassigned</SelectItem>
                      {(assignees.data ?? []).map((person) => (
                        <SelectItem key={person.id} value={String(person.id)}>
                          {person.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    className="w-full"
                    variant="outline"
                    disabled={assign.isPending}
                    onClick={() => assign.mutate()}
                  >
                    Save assignment
                  </Button>
                </div>
                {workflow.data?.data.required &&
                !workflow.data.data.in_progress &&
                workflow.data.data.can_forward ? (
                  <Button
                    className="mt-4 w-full"
                    disabled={forward.isPending}
                    onClick={() => forward.mutate()}
                  >
                    {forward.isPending
                      ? "Forwarding..."
                      : "Forward for Approval"}
                  </Button>
                ) : null}
                {workflow.data?.data.required &&
                workflow.data.data.in_progress ? (
                  <p className="mt-4 text-xs text-muted-foreground">
                    This task is already in the approval queue.
                  </p>
                ) : null}
              </aside>
            </div>
          </TabsContent>
          <TabsContent value="activity">
            <div className="grid gap-5 lg:grid-cols-3">
              <section className="rounded-lg border bg-card p-5 lg:col-span-2">
                <h2 className="font-semibold">Progress Updates</h2>
                <div className="mt-3 grid gap-2 sm:grid-cols-[8rem_8rem_1fr_auto]">
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    value={progress}
                    onChange={(event) => setProgress(event.target.value)}
                    placeholder="Progress %"
                  />
                  <Input
                    type="number"
                    min="0"
                    step="0.25"
                    value={timeSpent}
                    onChange={(event) => setTimeSpent(event.target.value)}
                    placeholder="Hours worked"
                  />
                  <Textarea
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder="Describe completed work, blockers, or next action"
                  />
                  <Button
                    disabled={!progress || !note.trim() || addUpdate.isPending}
                    onClick={() => addUpdate.mutate()}
                  >
                    Add update
                  </Button>
                </div>
                <div className="mt-4 space-y-3">
                  {(updates.data ?? []).map((update) => (
                    <div className="rounded border p-3 text-sm" key={update.id}>
                      <div className="flex justify-between gap-3">
                        <span className="font-medium">
                          {update.progress_percentage}% progress
                          {Number(update.time_spent_hours) > 0
                            ? ` · ${update.time_spent_hours} h logged`
                            : ""}
                        </span>
                        <span className="text-muted-foreground">
                          {formatDate(update.created_at)}
                        </span>
                      </div>
                      <p className="mt-1 text-muted-foreground">
                        {update.update_description}
                      </p>
                    </div>
                  ))}
                  {!updates.data?.length && (
                    <p className="text-sm text-muted-foreground">
                      No progress updates recorded yet.
                    </p>
                  )}
                </div>
              </section>
              <section className="rounded-lg border bg-card p-5">
                <h2 className="font-semibold">Follow-ups</h2>
                <div className="mt-3 space-y-2">
                  <Input
                    type="date"
                    value={followUpDate}
                    onChange={(event) => setFollowUpDate(event.target.value)}
                  />
                  <Textarea
                    value={followUpNotes}
                    onChange={(event) => setFollowUpNotes(event.target.value)}
                    placeholder="What needs to happen?"
                  />
                  <Button
                    className="w-full"
                    variant="outline"
                    disabled={!followUpDate || addFollowUp.isPending}
                    onClick={() => addFollowUp.mutate()}
                  >
                    Schedule follow-up
                  </Button>
                </div>
                <div className="mt-4 space-y-2">
                  {(followUps.data ?? []).map((followUp) => (
                    <div
                      className="rounded border p-3 text-sm"
                      key={followUp.id}
                    >
                      <div className="flex justify-between gap-2">
                        <span className="font-medium">
                          {formatDate(followUp.follow_up_date)}
                        </span>
                        <Badge variant="outline">{followUp.status}</Badge>
                      </div>
                      <p className="mt-1 text-muted-foreground">
                        {followUp.notes || "No notes"}
                      </p>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <p className="text-xs text-muted-foreground">
                          Owner: {followUp.owner_name}
                        </p>
                        {!["completed", "cancelled"].includes(
                          followUp.status,
                        ) ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={completeFollowUp.isPending}
                            onClick={() => completeFollowUp.mutate(followUp.id)}
                          >
                            Complete
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                  {!followUps.data?.length && (
                    <p className="text-sm text-muted-foreground">
                      No follow-ups are scheduled yet.
                    </p>
                  )}
                </div>
              </section>
            </div>
          </TabsContent>
          <TabsContent value="discussion">
            <div className="grid gap-5 lg:grid-cols-3">
              <section className="rounded-lg border bg-card p-5 lg:col-span-3">
                <h2 className="font-semibold">Discussion</h2>
                <div className="mt-3 flex gap-2">
                  <Textarea
                    value={comment}
                    onChange={(event) => setComment(event.target.value)}
                    placeholder="Add a task comment"
                  />
                  <Button
                    disabled={!comment.trim() || addComment.isPending}
                    onClick={() => addComment.mutate()}
                  >
                    Comment
                  </Button>
                </div>
                <div className="mt-4 space-y-3">
                  {(comments.data ?? []).map((entry) => (
                    <div className="rounded border p-3 text-sm" key={entry.id}>
                      <div className="flex justify-between gap-3">
                        <span className="font-medium">{entry.author_name}</span>
                        <span className="text-muted-foreground">
                          {formatDate(entry.created_at)}
                        </span>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap text-muted-foreground">
                        {entry.body}
                      </p>
                    </div>
                  ))}
                  {!comments.data?.length && (
                    <p className="text-sm text-muted-foreground">
                      No discussion entries yet.
                    </p>
                  )}
                </div>
              </section>
              <section className="rounded-lg border bg-card p-5 lg:col-span-3">
                <h2 className="font-semibold">Attachments & Evidence</h2>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Input
                    className="max-w-md"
                    type="file"
                    onChange={(event) =>
                      setAttachment(event.target.files?.[0] ?? null)
                    }
                  />
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      checked={isEvidence}
                      type="checkbox"
                      onChange={(event) => setIsEvidence(event.target.checked)}
                    />{" "}
                    Approval evidence
                  </label>
                  <Button
                    disabled={!attachment || uploadAttachment.isPending}
                    onClick={() => uploadAttachment.mutate()}
                  >
                    {uploadAttachment.isPending ? "Uploading..." : "Upload"}
                  </Button>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Up to 10 MB per file. Mark evidence so reviewers can identify
                  supporting material quickly.
                </p>
                <div className="mt-4 space-y-2">
                  {(attachments.data ?? []).map((file) => (
                    <div
                      className="flex items-center justify-between rounded border p-3 text-sm hover:bg-muted/40"
                      key={file.id}
                    >
                      <a href={file.file} rel="noreferrer" target="_blank">
                        <span>
                          {file.original_name}
                          {file.is_evidence ? " (evidence)" : ""}
                        </span>
                      </a>
                      <div className="flex items-center gap-3">
                        <span className="text-muted-foreground">
                          {file.uploaded_by_name}
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={removeAttachment.isPending}
                          onClick={() => {
                            if (
                              window.confirm(`Remove “${file.original_name}”?`)
                            )
                              removeAttachment.mutate(file.id);
                          }}
                        >
                          Remove
                        </Button>
                      </div>
                    </div>
                  ))}
                  {!attachments.data?.length && (
                    <p className="text-sm text-muted-foreground">
                      No files attached to this task.
                    </p>
                  )}
                </div>
              </section>
            </div>
          </TabsContent>
          <TabsContent value="structure">
            <div className="grid gap-5 lg:grid-cols-3">
              <section className="rounded-lg border bg-card p-5 lg:col-span-3">
                <h2 className="font-semibold">Subtasks & Dependencies</h2>
                <div className="mt-3 grid gap-5 lg:grid-cols-2">
                  <div>
                    <Button
                      variant="outline"
                      onClick={() => setSubtaskOpen(true)}
                    >
                      Create planned subtask
                    </Button>
                    <div className="mt-3 space-y-2">
                      {(structure.data?.subtasks ?? []).map((subtask) => (
                        <Link
                          href={`/projects/tasks/${subtask.id}`}
                          key={subtask.id}
                        >
                          <div className="cursor-pointer rounded border p-3 text-sm hover:bg-muted/40">
                            {subtask.number} - {subtask.title}{" "}
                            <Badge className="ml-2" variant="outline">
                              {subtask.status}
                            </Badge>
                          </div>
                        </Link>
                      ))}
                      {!structure.data?.subtasks.length && (
                        <p className="text-sm text-muted-foreground">
                          No subtasks yet.
                        </p>
                      )}
                    </div>
                  </div>
                  <div>
                    <div className="flex gap-2">
                      <Select
                        value={dependencyId}
                        onValueChange={setDependencyId}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Add dependency" />
                        </SelectTrigger>
                        <SelectContent>
                          {(structure.data?.candidates ?? []).map(
                            (candidate) => (
                              <SelectItem
                                key={candidate.id}
                                value={String(candidate.id)}
                              >
                                {candidate.number} - {candidate.title}
                              </SelectItem>
                            ),
                          )}
                        </SelectContent>
                      </Select>
                      <Button
                        disabled={!dependencyId || addStructure.isPending}
                        onClick={() =>
                          addStructure.mutate({
                            action: "dependency",
                            depends_on_id: dependencyId,
                          })
                        }
                      >
                        Add dependency
                      </Button>
                    </div>
                    <div className="mt-3 space-y-2">
                      {(structure.data?.dependencies ?? []).map(
                        (dependency) => (
                          <Link
                            href={`/projects/tasks/${dependency.id}`}
                            key={dependency.id}
                          >
                            <div className="cursor-pointer rounded border p-3 text-sm hover:bg-muted/40">
                              {dependency.number} - {dependency.title}{" "}
                              <Badge className="ml-2" variant="outline">
                                {dependency.status}
                              </Badge>
                            </div>
                          </Link>
                        ),
                      )}
                      {!structure.data?.dependencies.length && (
                        <p className="text-sm text-muted-foreground">
                          No dependencies recorded.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </section>
            </div>
          </TabsContent>
          <TabsContent value="workflow">
            <div className="grid gap-5 lg:grid-cols-3">
              <section className="rounded-lg border bg-card p-5 lg:col-span-3">
                <h2 className="font-semibold">Workflow History</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Every submission, decision, and reviewer comment for this
                  task.
                </p>
                <div className="mt-4 space-y-3">
                  {(workflowHistory.data?.data ?? []).map((item) => (
                    <div className="rounded border p-3 text-sm" key={item.id}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <strong>{item.title}</strong>
                        <Badge variant="outline">{item.status}</Badge>
                      </div>
                      <p className="mt-1 text-muted-foreground">
                        {item.detail}
                      </p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        Assigned to {item.assigned_group_name || "an approver"}{" "}
                        · {formatDateTime(item.created_at)}
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
                            by {event.actor_name} · {formatDateTime(event.at)}
                            {event.comment ? ` — ${event.comment}` : ""}
                          </div>
                        ),
                      )}
                    </div>
                  ))}
                  {!workflowHistory.data?.data.length && (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      This task has not entered a workflow yet.
                    </p>
                  )}
                </div>
              </section>
            </div>
          </TabsContent>
        </Tabs>
      )}
    </ERPWorkspacePage>
  );
}
