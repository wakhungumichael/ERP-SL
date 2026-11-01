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
import { Label } from "@/components/ui/label";
import {
  ProjectSelect,
  MilestoneSelect,
  TaskTypeSelect,
  AssigneeSelect,
} from "@/components/projects/task-fields";
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
import { hasPermission } from "@/lib/permissions";
import { RecordAuditTrail } from "@/components/audit/record-audit-trail";

import {
  TaskStatusSelect,
  TASK_STATUSES,
  type TaskStatusOption,
} from "@/components/projects/task-status";

import { TaskRelatedRegister } from "@/components/projects/related-register";
import { TaskActivityPanel } from "@/components/projects/task-activity-panel";

type Task = {
  access?: Record<string, boolean>;
  is_active: boolean;
  deactivated_at?: string | null;
  status_options?: TaskStatusOption[];
  project: number;
  milestone: number | null;
  milestone_name?: string;
  number: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  progress_percentage: number;
  project_name: string;
  branch_name: string;
  assignee_name: string;
  primary_assignee: number | null;
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
  mention_names: string[];
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
type Collaborator = {
  id: number;
  user: number;
  user_name: string;
  participation_role: "accountable" | "supporting";
};
type ChecklistItem = {
  id: number;
  title: string;
  is_completed: boolean;
  completed_by_name: string;
};
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
    binding: { id: number; workflow_id: number; workflow_name: string } | null;
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

function projectDetailKey(
  path: string,
  token: string | null,
  user: Record<string, unknown> | null,
) {
  return [
    "project-detail",
    path,
    token,
    user?.organization_id,
    user?.branch_id,
    user?.active_branch_id,
    user?.active_role_group_name,
  ];
}
function useProjectApi<T>(path: string, token: string | null) {
  const { user } = useAuth();
  return useQuery<T>({
    queryKey: projectDetailKey(path, token, user),
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
  const { token, user } = useAuth();
  const { toast } = useToast();
  const client = useQueryClient();
  const taskPath = `/api/projects/tasks/${id}/`;
  const updatesPath = `${taskPath}updates/`;
  const followUpsPath = `${taskPath}follow-ups/`;
  const commentsPath = `${taskPath}comments/`;
  const attachmentsPath = `${taskPath}attachments/`;
  const assigneesPath = `${taskPath}assignees/`;
  const collaboratorsPath = `${taskPath}collaborators/`;
  const checklistPath = `${taskPath}checklist/`;
  const structurePath = `${taskPath}structure/`;
  const task = useProjectApi<Task>(taskPath, token);
  const assignees = useProjectApi<Assignee[]>(assigneesPath, token);
  const collaborators = useProjectApi<Collaborator[]>(collaboratorsPath, token);
  const structure = useProjectApi<Structure>(
    structurePath + "?kind=options",
    token,
  );
  const workflow = useProjectApi<WorkflowRequirement>(
    `/api/platform/workflows/requirement/?module_slug=projects-tasks&entity_type=project_task&entity_id=${id}&trigger_event=submit`,
    token,
  );
  const historyPath = `/api/platform/workflows/history/?module_slug=projects-tasks&entity_type=project_task&entity_id=${id}`;
  const workflowHistory = useProjectApi<{ data: WorkflowItem[] }>(
    historyPath,
    token,
  );
  const [comment, setComment] = useState("");
  const [mentionedUserIds, setMentionedUserIds] = useState<number[]>([]);
  const [attachment, setAttachment] = useState<File | null>(null);
  const [isEvidence, setIsEvidence] = useState(false);
  const [assigneeId, setAssigneeId] = useState("unassigned");
  useEffect(() => {
    if (task.data)
      setAssigneeId(
        task.data.primary_assignee
          ? String(task.data.primary_assignee)
          : "unassigned",
      );
  }, [id, task.data?.primary_assignee]);
  const [collaboratorId, setCollaboratorId] = useState("");
  const [participantRole, setParticipantRole] = useState<
    "accountable" | "supporting"
  >("accountable");
  const [subtaskTitle, setSubtaskTitle] = useState("");
  const [subtaskDescription, setSubtaskDescription] = useState("");
  const [subtaskDueDate, setSubtaskDueDate] = useState("");
  const [subtaskPriority, setSubtaskPriority] = useState("medium");
  const [subtaskEstimatedHours, setSubtaskEstimatedHours] = useState("");
  const [subtaskOpen, setSubtaskOpen] = useState(false);
  const [dependencyId, setDependencyId] = useState("");
  const [editProject, setEditProject] = useState("");
  const [editMilestone, setEditMilestone] = useState("none");
  const [editAssignee, setEditAssignee] = useState("unassigned");
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
  }, [task.data?.number]);
  useEffect(() => {
    if (!task.data) return;
    setEditProject(String(task.data.project || ""));
    setEditMilestone(
      task.data.milestone ? String(task.data.milestone) : "none",
    );
    setEditAssignee(
      task.data.primary_assignee
        ? String(task.data.primary_assignee)
        : "unassigned",
    );
  }, [
    task.data?.number,
    task.data?.project,
    task.data?.milestone,
    task.data?.primary_assignee,
  ]);
  useEffect(() => {
    if (task.data) setEditStatus(task.data.status);
  }, [task.data?.number, task.data?.status]);
  const refresh = (paths: string[]) =>
    paths.forEach((path) => {
      void client.invalidateQueries({ queryKey: ["project-related", path] });
      void client.invalidateQueries({
        predicate: (query) =>
          query.queryKey[0] === "project-detail" &&
          String(query.queryKey[1]).split("?")[0] === path,
      });
    });
  const addUpdate = useMutation({
    mutationFn: async ({
      note,
      timeSpent,
    }: {
      note: string;
      timeSpent: string;
    }) => {
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
    mutationFn: async ({ date, notes }: { date: string; notes: string }) => {
      const response = await fetch(followUpsPath, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Token ${token}`,
        },
        body: JSON.stringify({
          follow_up_date: date,
          notes,
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
        body: JSON.stringify({
          body: comment,
          mention_user_ids: mentionedUserIds,
        }),
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
      setMentionedUserIds([]);
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
      if (!task.data || !assigneeId)
        throw new Error("Choose an assignee or explicitly select Unassigned.");
      const response = await fetch(`${taskPath}assign/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Token ${token}`,
        },
        body: JSON.stringify({
          primary_assignee:
            assigneeId === "unassigned" ? null : Number(assigneeId),
        }),
      });
      if (!response.ok)
        throw await apiErrorFromResponse(
          response,
          "Task assignment could not be saved.",
        );
      return response.json();
    },
    onSuccess: (data: Task) => {
      client.setQueryData(projectDetailKey(taskPath, token, user), data);
      setAssigneeId(
        data.primary_assignee ? String(data.primary_assignee) : "unassigned",
      );
      refresh([taskPath, assigneesPath, collaboratorsPath]);
      for (const key of [
        "projects",
        "project-record",
        "projects-kanban",
        "project-task-alerts",
      ])
        void client.invalidateQueries({ queryKey: [key] });
      toast({ title: "Task assignment updated" });
    },
    onError: (error: Error) =>
      toast({
        title: "Could not update assignment",
        description: error.message,
        variant: "destructive",
      }),
  });
  const addCollaborator = useMutation({
    mutationFn: async () => {
      if (!collaboratorId) throw new Error("Choose a participant.");
      const response = await fetch(collaboratorsPath, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Token ${token}`,
        },
        body: JSON.stringify({
          user_ids: [Number(collaboratorId)],
          participation_role: participantRole,
        }),
      });
      if (!response.ok)
        throw await apiErrorFromResponse(
          response,
          "Supporting participant could not be added.",
        );
      return response.json();
    },
    onSuccess: () => {
      setCollaboratorId("");
      refresh([collaboratorsPath]);
      toast({ title: "Task participant added" });
    },
    onError: (error: Error) =>
      toast({
        title: "Could not add supporting participant",
        description: error.message,
        variant: "destructive",
      }),
  });
  const addChecklistItem = useMutation({
    mutationFn: async (title: string) => {
      const response = await fetch(checklistPath, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Token ${token}`,
        },
        body: JSON.stringify({ title: title.trim() }),
      });
      if (!response.ok)
        throw await apiErrorFromResponse(
          response,
          "Deliverable could not be added.",
        );
      return response.json();
    },
    onSuccess: () => {
      refresh([checklistPath, taskPath]);
      toast({ title: "Deliverable added" });
    },
    onError: (error: Error) =>
      toast({
        title: "Could not add deliverable",
        description: error.message,
        variant: "destructive",
      }),
  });
  const toggleChecklistItem = useMutation({
    mutationFn: async (item: ChecklistItem) => {
      const response = await fetch(`${checklistPath}${item.id}/`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Token ${token}`,
        },
        body: JSON.stringify({ is_completed: !item.is_completed }),
      });
      if (!response.ok)
        throw await apiErrorFromResponse(
          response,
          "Deliverable could not be updated.",
        );
    },
    onSuccess: () => refresh([checklistPath, taskPath, structurePath]),
    onError: (error: Error) =>
      toast({
        title: "Could not update deliverable",
        description: error.message,
        variant: "destructive",
      }),
  });
  const removeCollaborator = useMutation({
    mutationFn: async (collaborator: Collaborator) => {
      const response = await fetch(`${collaboratorsPath}${collaborator.id}/`, {
        method: "DELETE",
        headers: { Authorization: `Token ${token}` },
      });
      if (!response.ok)
        throw await apiErrorFromResponse(
          response,
          "Supporting participant could not be removed.",
        );
    },
    onSuccess: () => {
      refresh([collaboratorsPath]);
      toast({ title: "Supporting participant removed" });
    },
    onError: (error: Error) =>
      toast({
        title: "Could not remove supporting participant",
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
      if (!editProject) throw new Error("Choose a project.");
      if (!editTaskType.trim() || editTaskType === "other")
        throw new Error("Choose a task type or enter a name for Other.");
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
          ...(task.data?.access?.can_move_project
            ? { project: Number(editProject) }
            : {}),
          milestone: editMilestone === "none" ? null : Number(editMilestone),
          ...(!!task.data?.access?.can_assign
            ? {
                primary_assignee:
                  editAssignee === "unassigned" ? null : Number(editAssignee),
              }
            : {}),
          description: editDescription,
          task_type: editTaskType || "general",
          start_date: editStartDate || null,
          due_date: editDueDate || null,
          estimated_hours: editEstimatedHours || null,
          priority: editPriority,
          ...(editStatus !== task.data?.status ? { status: editStatus } : {}),
        }),
      });
      if (!response.ok)
        throw await apiErrorFromResponse(
          response,
          "Task changes could not be saved.",
        );
      return response.json();
    },
    onSuccess: (data: Task) => {
      client.setQueryData(projectDetailKey(taskPath, token, user), data);
      refresh([
        taskPath,
        updatesPath,
        assigneesPath,
        collaboratorsPath,
        structurePath,
      ]);
      for (const key of [
        "project-record",
        "projects",
        "projects-kanban",
        "project-task-alerts",
      ])
        void client.invalidateQueries({ queryKey: [key] });
      toast({ title: "Task details updated" });
    },
    onError: (error: Error) =>
      toast({
        title: "Could not update task",
        description: error.message,
        variant: "destructive",
      }),
  });
  const changeStatus = useMutation({
    mutationFn: async (status: string) => {
      const response = await fetch(taskPath, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Token ${token}`,
        },
        body: JSON.stringify({ status }),
      });
      if (!response.ok)
        throw await apiErrorFromResponse(
          response,
          "Status could not be changed.",
        );
      return response.json() as Promise<Task>;
    },
    onSuccess: (data) => {
      client.setQueryData(projectDetailKey(taskPath, token, user), data);
      refresh([taskPath, updatesPath, historyPath]);
      for (const key of [
        "project-record",
        "projects",
        "projects-kanban",
        "projects-dashboard",
        "project-task-alerts",
      ])
        void client.invalidateQueries({ queryKey: [key] });
      toast({
        title: `Task moved to ${TASK_STATUSES.find((option) => option.value === data.status)?.label || data.status}`,
      });
    },
    onError: (error: Error) =>
      toast({
        title: "Could not change status",
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
  const toggleActive = useMutation({
    mutationFn: async () => {
      const response = await fetch(`${taskPath}activation/`, {
        method: "POST",
        headers: {
          Authorization: `Token ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ is_active: task.data?.is_active === false }),
      });
      if (!response.ok)
        throw await apiErrorFromResponse(
          response,
          "Task activation could not be updated.",
        );
      return response.json() as Promise<Task>;
    },
    onSuccess: (data) => {
      client.setQueryData(projectDetailKey(taskPath, token, user), data);
      refresh([taskPath, updatesPath]);
      for (const key of [
        "projects",
        "project-record",
        "project-related",
        "projects-kanban",
        "project-task-alerts",
        "project-followups",
        "projects-follow-ups",
      ])
        void client.invalidateQueries({ queryKey: [key] });
      toast({
        title: data.is_active ? "Task reactivated" : "Task deactivated",
        description: "Assignment, files, and history are retained.",
      });
    },
    onError: (error: Error) =>
      toast({
        title: "Could not update task activity",
        description: error.message,
        variant: "destructive",
      }),
  });
  const record = task.data;
  const inactive = record?.is_active === false;
  const access = record?.access ?? {};
  const statusOptions: TaskStatusOption[] =
    record?.status_options || TASK_STATUSES;
  const alternativeStatuses = statusOptions.filter(
    (option) => option.value !== record?.status,
  );
  const statusUnavailableReason = alternativeStatuses.every(
    (option) => option.disabled,
  )
    ? alternativeStatuses.find((option) => option.reason)?.reason
    : "";
  const showApprovals = Boolean(
    workflow.data?.data.required ||
    workflow.data?.data.in_progress ||
    workflow.data?.data.binding ||
    workflowHistory.data?.data?.length,
  );
  const availableParticipants = (assignees.data ?? []).filter(
    (person) =>
      Number(person.id) !== Number(record?.primary_assignee) &&
      !(collaborators.data ?? []).some(
        (collaborator) =>
          Number(collaborator.user) === Number(person.id) &&
          collaborator.participation_role === participantRole,
      ),
  );
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
          {access.can_deactivate && (
            <Button
              variant="outline"
              disabled={toggleActive.isPending}
              onClick={() => toggleActive.mutate()}
            >
              {toggleActive.isPending
                ? "Saving..."
                : inactive
                  ? "Reactivate task"
                  : "Deactivate task"}
            </Button>
          )}
          <Button
            disabled={!access.can_create_subtask}
            onClick={() => setSubtaskOpen(true)}
          >
            Create subtask
          </Button>
        </div>
      )}
      {inactive && (
        <div
          role="status"
          className="mb-4 rounded-lg border bg-muted/40 p-4 text-sm"
        >
          <strong>Inactive task.</strong> Assignment and history are retained.
          Reactivate this task to make changes.
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
              disabled={
                !access.can_create_subtask ||
                !subtaskTitle.trim() ||
                addStructure.isPending
              }
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
      {!record ? (
        <div className="rounded-lg border bg-card p-8 text-sm text-muted-foreground">
          Loading task details...
        </div>
      ) : (
        <Tabs defaultValue="overview">
          <TabsList className="h-auto w-full flex-wrap justify-start gap-1">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="activity">Activity & follow-ups</TabsTrigger>
            <TabsTrigger value="discussion">Discussions</TabsTrigger>
            <TabsTrigger value="files">Files</TabsTrigger>
            <TabsTrigger value="structure">Subtasks & dependencies</TabsTrigger>
            {showApprovals && (
              <TabsTrigger value="workflow">Approvals</TabsTrigger>
            )}
          </TabsList>
          <TabsContent value="overview">
            <div className="grid gap-5 lg:grid-cols-3">
              <section className="min-w-0 rounded-lg border bg-card p-5 lg:col-span-2">
                <h2 className="font-semibold">Task Summary</h2>
                <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">
                  {record.description || "No task description provided."}
                </p>
                <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-muted-foreground">Project</dt>
                    <dd className="font-medium">
                      {record.project_name || "General"}
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
                {access.can_edit && (
                  <details className="mt-5 rounded border p-3">
                    <summary className="cursor-pointer font-medium">
                      Edit task planning
                    </summary>
                    <div className="mt-3 grid gap-3">
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                          <Label htmlFor="edit-task-project" required>
                            Project
                          </Label>
                          <ProjectSelect
                            id="edit-task-project"
                            disabled={!access.can_move_project}
                            value={editProject}
                            current={{
                              id: record.project,
                              name: record.project_name,
                            }}
                            onChange={(value) => {
                              setEditProject(value);
                              setEditMilestone("none");
                            }}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="edit-task-milestone">Milestone</Label>
                          <MilestoneSelect
                            id="edit-task-milestone"
                            projectId={editProject}
                            value={editMilestone}
                            onChange={setEditMilestone}
                          />
                        </div>
                        {!!task.data?.access?.can_assign && (
                          <div className="space-y-2">
                            <Label htmlFor="edit-task-assignee">
                              Lead assignee
                            </Label>
                            <AssigneeSelect
                              id="edit-task-assignee"
                              taskId={id}
                              projectId={editProject}
                              value={editAssignee}
                              currentLabel={record.assignee_name}
                              onChange={setEditAssignee}
                            />
                          </div>
                        )}
                      </div>
                      <Label htmlFor="edit-task-title" required>
                        Task title
                      </Label>

                      <Input
                        id="edit-task-title"
                        value={editTitle}
                        onChange={(event) => setEditTitle(event.target.value)}
                        placeholder="Task title"
                      />
                      <Label htmlFor="edit-task-description">Description</Label>
                      <Textarea
                        id="edit-task-description"
                        value={editDescription}
                        onChange={(event) =>
                          setEditDescription(event.target.value)
                        }
                        placeholder="Task description"
                      />
                      <div className="grid gap-2 sm:grid-cols-2">
                        <div className="space-y-2">
                          <Label htmlFor="edit-task-type">Task type</Label>
                          <TaskTypeSelect
                            id="edit-task-type"
                            value={editTaskType || "general"}
                            onChange={setEditTaskType}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="edit-task-hours">
                            Estimated hours
                          </Label>
                          <Input
                            id="edit-task-hours"
                            value={editEstimatedHours}
                            min="0"
                            step="0.25"
                            type="number"
                            onChange={(event) =>
                              setEditEstimatedHours(event.target.value)
                            }
                            placeholder="Estimated hours"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="edit-task-start">Start date</Label>
                          <Input
                            id="edit-task-start"
                            value={editStartDate}
                            type="date"
                            onChange={(event) =>
                              setEditStartDate(event.target.value)
                            }
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="edit-task-due">Due date</Label>
                          <Input
                            id="edit-task-due"
                            value={editDueDate}
                            min={editStartDate || undefined}
                            type="date"
                            onChange={(event) =>
                              setEditDueDate(event.target.value)
                            }
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="edit-task-priority">Priority</Label>
                          <Select
                            value={editPriority}
                            onValueChange={setEditPriority}
                          >
                            <SelectTrigger id="edit-task-priority">
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
                        <div className="space-y-2">
                          <Label htmlFor="edit-task-status">Status</Label>
                          <TaskStatusSelect
                            id="edit-task-status"
                            value={editStatus}
                            options={statusOptions}
                            onChange={setEditStatus}
                            disabled={
                              inactive ||
                              changeStatus.isPending ||
                              saveTask.isPending
                            }
                          />
                        </div>
                      </div>
                      <Button
                        className="w-fit"
                        disabled={
                          inactive || saveTask.isPending || !editProject
                        }
                        onClick={() => saveTask.mutate()}
                      >
                        {saveTask.isPending ? "Saving..." : "Save task details"}
                      </Button>
                    </div>
                  </details>
                )}
              </section>
              <aside className="min-w-0 rounded-lg border bg-card p-5">
                <h2 className="font-semibold">Status and progress</h2>
                <div className="mt-3 space-y-2">
                  <Label htmlFor="task-status">Task status</Label>
                  <TaskStatusSelect
                    id="task-status"
                    value={record.status}
                    options={statusOptions}
                    onChange={(value) => changeStatus.mutate(value)}
                    disabled={
                      !access.can_edit ||
                      changeStatus.isPending ||
                      saveTask.isPending ||
                      forward.isPending
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    {changeStatus.isPending
                      ? "Updating status..."
                      : statusUnavailableReason ||
                        "Choose a status to update this task immediately. Reopen closed work when more action is needed."}
                  </p>
                </div>
                <div className="mt-5 text-3xl font-bold">
                  {record.progress_percentage}%
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {workflow.data?.data.current_stage
                    ? `Approval stage: ${workflow.data.data.current_stage}${workflow.data.data.current_role ? ` - ${workflow.data.data.current_role}` : ""}`
                    : workflow.data?.data.required
                      ? workflow.data.data.can_forward
                        ? "Completion requires approval. Use Send for approval below."
                        : "Completion requires approval. Ask your project lead to send this task for approval."
                      : "Mark Completed when the work is done. Completion sets progress to 100%."}
                </p>
                <div className="mt-4 space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">
                    Lead assignee
                  </p>
                  <Select
                    value={assigneeId}
                    onValueChange={setAssigneeId}
                    disabled={
                      inactive ||
                      assign.isPending ||
                      !!!task.data?.access?.can_assign
                    }
                  >
                    <SelectTrigger
                      id="task-lead-assignee"
                      aria-label="Lead assignee"
                    >
                      <SelectValue
                        placeholder={record.assignee_name || "Unassigned"}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unassigned">Unassigned</SelectItem>
                      {record.primary_assignee &&
                        !assignees.data?.some(
                          (person) => person.id === record.primary_assignee,
                        ) && (
                          <SelectItem value={String(record.primary_assignee)}>
                            {record.assignee_name || "Current assignee"}
                          </SelectItem>
                        )}
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
                    disabled={
                      inactive ||
                      assign.isPending ||
                      !task.data ||
                      !!!task.data?.access?.can_assign ||
                      assigneeId ===
                        String(record.primary_assignee || "unassigned")
                    }
                    onClick={() => assign.mutate()}
                  >
                    Save assignment
                  </Button>
                </div>
                <div className="mt-4 space-y-2 border-t pt-4">
                  <p className="text-xs font-medium text-muted-foreground">
                    Additional assignees and participants
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Select
                      value={participantRole}
                      onValueChange={(value) => {
                        setParticipantRole(
                          value as "accountable" | "supporting",
                        );
                        setCollaboratorId("");
                      }}
                    >
                      <SelectTrigger
                        id="task-participant-role"
                        aria-label="Participant role"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="accountable">
                          Accountable assignee
                        </SelectItem>
                        <SelectItem value="supporting">
                          Supporting participant
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <Select
                      value={collaboratorId}
                      onValueChange={setCollaboratorId}
                    >
                      <SelectTrigger
                        id="task-participant-user"
                        aria-label="Add participant"
                      >
                        <SelectValue placeholder="Add participant" />
                      </SelectTrigger>
                      <SelectContent>
                        {availableParticipants.map((person) => (
                          <SelectItem key={person.id} value={String(person.id)}>
                            {person.name}
                          </SelectItem>
                        ))}
                        {!availableParticipants.length && (
                          <SelectItem value="no-eligible-participants" disabled>
                            All eligible teammates already have this role
                          </SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                    <Button
                      variant="outline"
                      aria-label="Add task participant"
                      disabled={
                        !access.can_assign ||
                        !collaboratorId ||
                        addCollaborator.isPending
                      }
                      onClick={() => addCollaborator.mutate()}
                    >
                      Add
                    </Button>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(collaborators.data ?? []).map((collaborator) => (
                      <Badge
                        className="flex items-center gap-1"
                        key={collaborator.id}
                        variant="secondary"
                      >
                        {collaborator.user_name} ·{" "}
                        {collaborator.participation_role === "accountable"
                          ? "Accountable"
                          : "Supporting"}
                        <button
                          aria-label={`Remove ${collaborator.user_name}`}
                          className="ml-1 text-muted-foreground hover:text-foreground"
                          disabled={
                            !access.can_assign || removeCollaborator.isPending
                          }
                          onClick={() =>
                            removeCollaborator.mutate(collaborator)
                          }
                          type="button"
                        >
                          ×
                        </button>
                      </Badge>
                    ))}
                    {!collaborators.data?.length && (
                      <span className="text-xs text-muted-foreground">
                        No additional assignees or participants.
                      </span>
                    )}
                  </div>
                </div>
                {workflow.data?.data.required &&
                !workflow.data.data.in_progress &&
                workflow.data.data.can_forward ? (
                  <div className="mt-4 rounded-md border p-3">
                    <p className="mb-2 text-xs text-muted-foreground">
                      Uses configured workflow:{" "}
                      {workflow.data.data.binding?.workflow_name}
                    </p>
                    <Button
                      className="w-full"
                      disabled={inactive || forward.isPending}
                      onClick={() => forward.mutate()}
                    >
                      {forward.isPending
                        ? "Forwarding..."
                        : "Send for approval"}
                    </Button>
                  </div>
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
          <TabsContent value="activity" className="min-w-0">
            <TaskActivityPanel
              key={id}
              taskId={id}
              projectId={record.project}
              progress={record.progress_percentage}
              inactive={inactive}
              canProgress={!!access.can_update_progress}
              canAddFollowUp={!!access.can_add_followup}
              canCompleteFollowUp={!!access.can_complete_followup}
              saving={
                addUpdate.isPending ||
                addFollowUp.isPending ||
                addChecklistItem.isPending
              }
              checklistBusy={toggleChecklistItem.isPending}
              followUpBusy={completeFollowUp.isPending}
              onAddDeliverable={(title) => addChecklistItem.mutateAsync(title)}
              onAddUpdate={(values) => addUpdate.mutateAsync(values)}
              onAddFollowUp={(values) => addFollowUp.mutateAsync(values)}
              onToggleDeliverable={(item) =>
                toggleChecklistItem.mutate(item as ChecklistItem)
              }
              onCompleteFollowUp={(followUpId) =>
                completeFollowUp.mutate(followUpId)
              }
            />
          </TabsContent>
          <TabsContent value="discussion">
            <div className="grid gap-5 lg:grid-cols-3">
              <section className="min-w-0 rounded-lg border bg-card p-5 lg:col-span-3">
                <h2 className="font-semibold">Discussion</h2>
                <div className="mt-3 flex gap-2">
                  <Textarea
                    value={comment}
                    onChange={(event) => setComment(event.target.value)}
                    placeholder="Add a task comment"
                  />
                  <Button
                    disabled={
                      !access.can_comment ||
                      !comment.trim() ||
                      addComment.isPending
                    }
                    onClick={() => addComment.mutate()}
                  >
                    Comment
                  </Button>
                </div>
                {(assignees.data ?? []).length > 0 && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                    <span className="text-muted-foreground">
                      Notify people:
                    </span>
                    {(assignees.data ?? []).map((candidate) => {
                      const selected = mentionedUserIds.includes(candidate.id);
                      return (
                        <Button
                          key={candidate.id}
                          type="button"
                          size="sm"
                          variant={selected ? "default" : "outline"}
                          onClick={() =>
                            setMentionedUserIds((current) =>
                              selected
                                ? current.filter(
                                    (userId) => userId !== candidate.id,
                                  )
                                : [...current, candidate.id],
                            )
                          }
                        >
                          @{candidate.name}
                        </Button>
                      );
                    })}
                  </div>
                )}
                <TaskRelatedRegister
                  taskId={id}
                  projectId={record.project}
                  kind="comments"
                />
              </section>
            </div>
          </TabsContent>
          <TabsContent value="files">
            <div className="grid gap-5 lg:grid-cols-3">
              <section className="min-w-0 rounded-lg border bg-card p-5 lg:col-span-3">
                <h2 className="font-semibold">Attachments & Evidence</h2>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Input
                    className="max-w-md"
                    type="file"
                    disabled={!access.can_attach}
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
                    disabled={
                      !access.can_attach ||
                      !attachment ||
                      uploadAttachment.isPending
                    }
                    onClick={() => uploadAttachment.mutate()}
                  >
                    {uploadAttachment.isPending ? "Uploading..." : "Upload"}
                  </Button>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Up to 10 MB per file. Mark evidence so reviewers can identify
                  supporting material quickly.
                </p>
                <TaskRelatedRegister
                  taskId={id}
                  projectId={record.project}
                  kind="attachments"
                  onRemove={(fileId) => removeAttachment.mutate(fileId)}
                  busy={inactive || removeAttachment.isPending}
                  canRemove={!!access.can_remove_attachment}
                />
              </section>
            </div>
          </TabsContent>
          <TabsContent value="structure">
            <div className="grid gap-5 lg:grid-cols-3">
              <section className="min-w-0 rounded-lg border bg-card p-5 lg:col-span-3">
                <h2 className="font-semibold">Subtasks & Dependencies</h2>
                <div className="mt-3 grid gap-5 lg:grid-cols-2">
                  <div className="min-w-0">
                    <Button
                      variant="outline"
                      disabled={!access.can_create_subtask}
                      onClick={() => setSubtaskOpen(true)}
                    >
                      Create planned subtask
                    </Button>
                    <TaskRelatedRegister
                      taskId={id}
                      projectId={record.project}
                      kind="subtasks"
                    />
                  </div>
                  <div className="min-w-0">
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
                        disabled={
                          !access.can_edit ||
                          !dependencyId ||
                          addStructure.isPending
                        }
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
                    <TaskRelatedRegister
                      taskId={id}
                      projectId={record.project}
                      kind="dependencies"
                    />
                  </div>
                </div>
              </section>
            </div>
          </TabsContent>
          {showApprovals && (
            <TabsContent value="workflow">
              <div className="grid gap-5 lg:grid-cols-3">
                <section className="min-w-0 rounded-lg border bg-card p-5 lg:col-span-3">
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
                          Assigned to{" "}
                          {item.assigned_group_name || "an approver"} ·{" "}
                          {formatDateTime(item.created_at)}
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
          )}
        </Tabs>
      )}
    </ERPWorkspacePage>
  );
}
