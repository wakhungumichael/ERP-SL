import { useEffect, useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/context/use-auth";
import { useProjectSettings } from "./module-settings";
import { apiErrorFromResponse } from "@/lib/api-errors";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type ProjectOption = {
  id: number;
  code: string;
  name: string;
  is_general?: boolean;
  branch_name?: string;
};
export type MilestoneOption = { id: number; name: string; status: string };
export const EMPTY_TASK_FILTERS = {
  activity: "",
  number: "",
  title: "",
  project: "all",
  source_ticket: "",
  assignee: "all",
  priority: "all",
  task_type: "all",
  progress_min: "",
  progress_max: "",
};
export type TaskFilters = typeof EMPTY_TASK_FILTERS;

export function taskFilterParams(filters: TaskFilters) {
  return Object.fromEntries(
    Object.entries(filters).filter(
      ([key, value]) =>
        value !== "" &&
        !(
          value === "all" &&
          ["project", "assignee", "priority", "task_type"].includes(key)
        ),
    ),
  );
}

async function read<T>(path: string, token: string | null): Promise<T> {
  const response = await fetch(path, {
    headers: { Authorization: `Token ${token}` },
  });
  if (!response.ok) throw await apiErrorFromResponse(response);
  return response.json();
}

export function useProjectOptions() {
  const { token, user } = useAuth();
  return useQuery<ProjectOption[]>({
    queryKey: [
      "project-options",
      token,
      user?.organization_id,
      user?.branch_id,
    ],
    enabled: !!token,
    staleTime: 60000,
    queryFn: async () => {
      const rows: ProjectOption[] = [];
      let path: string | null = "/api/projects/project-options/?page_size=100";
      while (path) {
        const page: { results: ProjectOption[]; next: string | null } =
          await read(path, token);
        rows.push(...page.results);
        if (page.next) {
          const next = new URL(page.next, window.location.origin);
          path = next.pathname + next.search;
        } else path = null;
      }
      return rows;
    },
  });
}

export function ProjectSelect({
  value,
  onChange,
  id,
  all = false,
  defaultGeneral = false,
  current,
  disabled = false,
}: {
  disabled?: boolean;
  value: string;
  onChange: (value: string) => void;
  id?: string;
  all?: boolean;
  defaultGeneral?: boolean;
  current?: { id: number; name: string };
}) {
  const options = useProjectOptions();
  useEffect(() => {
    if (defaultGeneral && !value && options.data) {
      const general = options.data.find((row) => row.is_general);
      if (general) onChange(String(general.id));
    }
  }, [defaultGeneral, value, options.data, onChange]);
  return (
    <div className="min-w-0">
      <Select
        value={value}
        onValueChange={onChange}
        disabled={disabled || options.isLoading}
      >
        <SelectTrigger id={id} aria-required={!all} className="min-w-0">
          <SelectValue
            placeholder={
              options.isLoading ? "Loading projects…" : "Choose a project"
            }
          />
        </SelectTrigger>
        <SelectContent>
          {all && <SelectItem value="all">All projects</SelectItem>}
          {current && !options.data?.some((row) => row.id === current.id) && (
            <SelectItem value={String(current.id)}>{current.name}</SelectItem>
          )}
          {(options.data ?? []).map((row) => (
            <SelectItem key={row.id} value={String(row.id)}>
              {row.name}
              {row.is_general ? " · General work" : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {options.isError && (
        <p role="alert" className="mt-1 text-xs text-destructive">
          Projects could not be loaded. Please try again.
        </p>
      )}
    </div>
  );
}

export function MilestoneSelect({
  projectId,
  value,
  onChange,
  id,
}: {
  projectId: string;
  value: string;
  onChange: (value: string) => void;
  id?: string;
}) {
  const { token } = useAuth();
  const options = useQuery<MilestoneOption[]>({
    queryKey: ["milestone-options", projectId, token],
    enabled: !!token && !!projectId && projectId !== "all",
    queryFn: () =>
      read(`/api/projects/project-options/${projectId}/milestones/`, token),
  });
  return (
    <div className="min-w-0">
      <Select
        value={value}
        onValueChange={onChange}
        disabled={!projectId || options.isLoading}
      >
        <SelectTrigger id={id} className="min-w-0">
          <SelectValue placeholder="Choose a milestone" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">No milestone</SelectItem>
          {(options.data ?? []).map((row) => (
            <SelectItem key={row.id} value={String(row.id)}>
              {row.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {options.isError && (
        <p role="alert" className="mt-1 text-xs text-destructive">
          Milestones could not be loaded.
        </p>
      )}
    </div>
  );
}

export function TaskTypeSelect({
  value,
  onChange,
  id,
  all = false,
}: {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  all?: boolean;
}) {
  const { token, user } = useAuth();
  const config = useProjectSettings();
  const [customMode, setCustomMode] = useState(false);
  const types = useQuery<
    Array<{ value: string; label: string; category: string }>
  >({
    queryKey: ["task-types", token, user?.organization_id, user?.branch_id],
    enabled: !!token,
    staleTime: 60000,
    queryFn: () => read("/api/projects/task-types/", token),
  });
  useEffect(() => {
    if (types.data?.some((row) => row.value === value && value !== "other"))
      setCustomMode(false);
  }, [value, types.data]);
  const groups = [...new Set((types.data ?? []).map((row) => row.category))];
  const unknown =
    !!types.data &&
    !!value &&
    value !== "all" &&
    !types.data.some((row) => row.value === value);
  const custom = customMode || value === "other" || unknown;
  const ownId = id || "custom-task-type";
  return (
    <div className="min-w-0 space-y-2">
      <Select
        value={custom ? "other" : value}
        onValueChange={(next) => {
          setCustomMode(next === "other");
          onChange(next === "other" ? "" : next);
        }}
        disabled={types.isLoading}
      >
        <SelectTrigger id={id} className="min-w-0">
          <SelectValue placeholder="Choose a task type" />
        </SelectTrigger>
        <SelectContent>
          {all && <SelectItem value="all">All task types</SelectItem>}
          {custom && !types.data?.some((row) => row.value === "other") && (
            <SelectItem value="other">Custom or saved type</SelectItem>
          )}
          {groups.map((group) => (
            <SelectGroup key={group}>
              <SelectLabel>{group}</SelectLabel>
              {types
                .data!.filter((row) => row.category === group)
                .map((row) => (
                  <SelectItem key={row.value} value={row.value}>
                    {row.label}
                  </SelectItem>
                ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
      {custom && (
        <div className="space-y-1">
          <Label htmlFor={`${ownId}-custom`}>
            {all ? "Task type name" : "Specify task type"}
          </Label>
          <Input
            id={`${ownId}-custom`}
            maxLength={100}
            value={value === "other" ? "" : value}
            onChange={(event) => onChange(event.target.value)}
            placeholder="For example: Veterinary visit or Fleet inspection"
            aria-required={!all}
            disabled={config.data?.allow_custom_task_types === false && !all}
          />
          <p className="text-xs text-muted-foreground">
            {config.data?.allow_custom_task_types === false
              ? "Existing saved type. Ask an administrator to configure a replacement."
              : "Use a clear name for work specific to your organization."}
          </p>
        </div>
      )}
      {types.isError && (
        <p role="alert" className="text-xs text-destructive">
          Task types could not be loaded.
        </p>
      )}
    </div>
  );
}

export function AssigneeSelect({
  value,
  onChange,
  id,
  projectId,
  taskId,
  all = false,
  currentLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  projectId?: string;
  taskId?: string;
  all?: boolean;
  currentLabel?: string;
}) {
  const { token, user } = useAuth();
  const path = taskId
    ? `/api/projects/tasks/${taskId}/assignees/`
    : "/api/projects/tasks/assignees/";
  const choices = useQuery<Array<{ id: number; name: string }>>({
    queryKey: [
      "eligible-task-assignees",
      path,
      projectId,
      token,
      user?.organization_id,
      user?.branch_id,
    ],
    enabled: !!token,
    queryFn: () =>
      read(
        path +
          (projectId && projectId !== "all" ? `?project=${projectId}` : ""),
        token,
      ),
  });
  return (
    <div className="min-w-0">
      <Select
        value={value}
        onValueChange={onChange}
        disabled={choices.isLoading}
      >
        <SelectTrigger id={id} className="min-w-0">
          <SelectValue placeholder="Choose a person" />
        </SelectTrigger>
        <SelectContent>
          {all && <SelectItem value="all">All assignees</SelectItem>}
          <SelectItem value="unassigned">Unassigned</SelectItem>
          {currentLabel &&
            value !== "unassigned" &&
            value !== "all" &&
            !choices.data?.some((row) => String(row.id) === value) && (
              <SelectItem value={value}>{currentLabel}</SelectItem>
            )}
          {(choices.data ?? []).map((row) => (
            <SelectItem key={row.id} value={String(row.id)}>
              {row.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {choices.isError && (
        <p role="alert" className="mt-1 text-xs text-destructive">
          Team members could not be loaded.
        </p>
      )}
    </div>
  );
}

export function TaskFilterFields({
  value,
  onChange,
  projectId,
}: {
  value: TaskFilters;
  onChange: (value: TaskFilters) => void;
  projectId?: string;
}) {
  const prefix = useId();
  const change = (field: keyof TaskFilters, next: string) =>
    onChange({ ...value, [field]: next });
  const textField = (
    field: keyof TaskFilters,
    label: string,
    type = "text",
  ) => (
    <div className="min-w-0 space-y-2" key={field}>
      <Label htmlFor={prefix + field}>{label}</Label>
      <Input
        id={prefix + field}
        type={type}
        min={type === "number" ? 0 : undefined}
        max={type === "number" ? 100 : undefined}
        value={value[field]}
        onChange={(e) => change(field, e.target.value)}
      />
    </div>
  );
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <div className="min-w-0 space-y-2">
        <Label htmlFor={prefix + "activity"}>Task activity</Label>
        <Select
          value={value.activity || "active"}
          onValueChange={(next) =>
            change("activity", next === "active" ? "" : next)
          }
        >
          <SelectTrigger id={prefix + "activity"}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active tasks</SelectItem>
            <SelectItem value="inactive">Inactive tasks</SelectItem>
            <SelectItem value="all">All tasks</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {textField("number", "Task number")}
      {textField("title", "Task title")}
      {!projectId && (
        <div className="min-w-0 space-y-2">
          <Label htmlFor={prefix + "project"}>Project</Label>
          <ProjectSelect
            id={prefix + "project"}
            value={value.project}
            onChange={(v) => change("project", v)}
            all
          />
        </div>
      )}
      {textField("source_ticket", "Source ticket")}
      <div className="min-w-0 space-y-2">
        <Label htmlFor={prefix + "assignee"}>Assigned to</Label>
        <AssigneeSelect
          id={prefix + "assignee"}
          value={value.assignee}
          onChange={(v) => change("assignee", v)}
          projectId={projectId || value.project}
          all
        />
      </div>
      <div className="min-w-0 space-y-2">
        <Label htmlFor={prefix + "priority"}>Priority</Label>
        <Select
          value={value.priority}
          onValueChange={(v) => change("priority", v)}
        >
          <SelectTrigger id={prefix + "priority"}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[
              ["all", "All priorities"],
              ["low", "Low"],
              ["medium", "Medium"],
              ["high", "High"],
              ["critical", "Critical"],
            ].map(([v, l]) => (
              <SelectItem key={v} value={v}>
                {l}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="min-w-0 space-y-2">
        <Label htmlFor={prefix + "type"}>Task type</Label>
        <TaskTypeSelect
          id={prefix + "type"}
          value={value.task_type}
          onChange={(v) => change("task_type", v)}
          all
        />
      </div>
      {textField("progress_min", "Minimum progress (%)", "number")}
      {textField("progress_max", "Maximum progress (%)", "number")}
    </div>
  );
}
