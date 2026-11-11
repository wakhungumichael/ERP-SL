import { ERPFilterBar } from '@/components/erp/listing/filter-bar';
import { Table } from "@/components/ui/table";
import { ERPListingScope, ERPListingActions, ERPPageSizeControl } from '@/components/erp/listing/listing-scope';
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { useAuth } from "@/context/use-auth";
import { ERPWorkspacePage } from "@/components/erp/workspace/workspace-page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ListingPagination } from "@/components/erp/listing/pagination";
import { TASK_STATUSES } from "@/components/projects/task-status";
import {
  useProjectSettings,
  type ProjectSettings,
} from "@/components/projects/module-settings";
import { apiErrorFromResponse } from "@/lib/api-errors";
import { useToast } from "@/hooks/use-toast";

export default function ProjectSettingsPage() {
  const { token } = useAuth();
  const { toast } = useToast();
  const client = useQueryClient();
  const config = useProjectSettings();
  const [draft, setDraft] = useState<ProjectSettings | null>(null),
    [page, setPage] = useState(1),
    [pageSize, setPageSize] = useState(25),
    [search, setSearch] = useState("");
  const [newCode, setNewCode] = useState(""),
    [newName, setNewName] = useState(""),
    [newCategory, setNewCategory] = useState("Organization");
  useEffect(() => {
    if (config.data) setDraft(structuredClone(config.data));
  }, [config.data]);
  const canManage = !!config.data?.can_manage;
  const update = (values: Partial<ProjectSettings>) =>
    setDraft((current) => (current ? { ...current, ...values } : current));
  const save = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/projects/settings/", {
        method: "PATCH",
        headers: {
          Authorization: `Token ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ...draft, version: draft?.updated_at }),
      });
      if (!response.ok)
        throw await apiErrorFromResponse(
          response,
          "Settings could not be saved.",
        );
      return response.json() as Promise<ProjectSettings>;
    },
    onSuccess: (data) => {
      setDraft(data);
      for (const key of [
        "project-settings",
        "task-types",
        "project-detail",
        "project-record",
        "project-related",
        "projects",
      ])
        void client.invalidateQueries({ queryKey: [key] });
      toast({ title: "Project settings saved" });
    },
    onError: (error: Error) =>
      toast({
        title: "Could not save settings",
        description: error.message,
        variant: "destructive",
      }),
  });
  const sync = useQuery<{ is_enabled: boolean; target_ticket_status: string }>({
    queryKey: ["project-ticket-sync-settings", token],
    enabled: !!token && canManage,
    queryFn: async () => {
      const response = await fetch("/api/projects/settings/ticket-task-sync/", {
        headers: { Authorization: `Token ${token}` },
      });
      if (!response.ok) throw await apiErrorFromResponse(response);
      return response.json();
    },
  });
  const [syncEnabled, setSyncEnabled] = useState(false),
    [syncTarget, setSyncTarget] = useState("resolved");
  useEffect(() => {
    if (sync.data) {
      setSyncEnabled(sync.data.is_enabled);
      setSyncTarget(sync.data.target_ticket_status);
    }
  }, [sync.data]);
  const saveSync = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/projects/settings/ticket-task-sync/", {
        method: "PUT",
        headers: {
          Authorization: `Token ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          is_enabled: syncEnabled,
          target_ticket_status: syncTarget,
        }),
      });
      if (!response.ok) throw await apiErrorFromResponse(response);
      return response.json();
    },
    onSuccess: () => {
      void sync.refetch();
      toast({ title: "Ticket sync settings saved" });
    },
    onError: (error: Error) =>
      toast({
        title: "Could not save ticket sync",
        description: error.message,
        variant: "destructive",
      }),
  });
  if (config.isError)
    return (
      <ERPWorkspacePage title="Project Configuration">
        <p role="alert">{config.error.message}</p>
      </ERPWorkspacePage>
    );
  if (!draft)
    return (
      <ERPWorkspacePage title="Project Configuration">
        <p>Loading settings…</p>
      </ERPWorkspacePage>
    );
  const rows = draft.task_types.filter((row) =>
    `${row.label} ${row.value} ${row.category}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const savedCodes = new Set(config.data?.task_types.map((row) => row.value));
  const editType = (
    value: string,
    changes: Partial<ProjectSettings["task_types"][number]>,
  ) =>
    update({
      task_types: draft.task_types.map((row) =>
        row.value === value ? { ...row, ...changes } : row,
      ),
    });
  return <ERPListingScope>{(
    <ERPWorkspacePage
      title="Project Configuration"
      description="Configure task types, defaults, statuses, follow-ups, and ticket sync for your organization."
      actions={
        <Link href="/projects/overview">
          <Button variant="outline">Back to Projects</Button>
        </Link>
      }
    >
      {!canManage && (
        <p className="rounded border p-3 text-sm">
          These settings are read-only. An organization administrator or a role
          with Change project module settings permission can update them.
        </p>
      )}
      <Tabs defaultValue="types">
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="types">Task types</TabsTrigger>
          <TabsTrigger value="defaults">Defaults</TabsTrigger>
          <TabsTrigger value="statuses">Statuses</TabsTrigger>
          <TabsTrigger value="followups">Follow-ups</TabsTrigger>
          <TabsTrigger value="ticket-sync">Ticket sync</TabsTrigger>
        </TabsList>
        <fieldset disabled={!canManage || save.isPending} className="min-w-0">
          <TabsContent value="types">
            <section className="space-y-4 rounded-lg border bg-card p-4">
              <h2 className="font-semibold">Task type catalog</h2>
              <p className="text-sm text-muted-foreground">
                Add types for any industry. Rename, categorize, or deactivate
                types without changing existing tasks. Codes stay fixed after
                saving.
              </p>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={draft.allow_custom_task_types}
                  onChange={(event) =>
                    update({ allow_custom_task_types: event.target.checked })
                  }
                />
                Allow Other with a typed task type
              </label>
              <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
                <div>
                  <Label htmlFor="new-type-code">Code</Label>
                  <Input
                    id="new-type-code"
                    value={newCode}
                    maxLength={100}
                    onChange={(event) => setNewCode(event.target.value)}
                    placeholder="fleet_inspection"
                  />
                </div>
                <div>
                  <Label htmlFor="new-type-name">Name</Label>
                  <Input
                    id="new-type-name"
                    value={newName}
                    maxLength={100}
                    onChange={(event) => setNewName(event.target.value)}
                    placeholder="Fleet inspection"
                  />
                </div>
                <div>
                  <Label htmlFor="new-type-category">Category</Label>
                  <Input
                    id="new-type-category"
                    value={newCategory}
                    maxLength={100}
                    onChange={(event) => setNewCategory(event.target.value)}
                  />
                </div>
                <Button
                  className="self-end"
                  variant="outline"
                  disabled={
                    !newCode.trim() || !newName.trim() || !newCategory.trim()
                  }
                  onClick={() => {
                    if (
                      !/^[a-z][a-z0-9_]{0,99}$/.test(newCode) ||
                      ["all", "other"].includes(newCode) ||
                      draft.task_types.some(
                        (row) =>
                          row.value === newCode ||
                          row.label.toLowerCase() ===
                            newName.trim().toLowerCase(),
                      )
                    ) {
                      toast({
                        title: "Use a unique code and name",
                        description:
                          "Codes use lowercase letters, numbers, and underscores.",
                        variant: "destructive",
                      });
                      return;
                    }
                    update({
                      task_types: [
                        ...draft.task_types,
                        {
                          value: newCode,
                          label: newName.trim(),
                          category: newCategory.trim(),
                          is_active: true,
                        },
                      ],
                    });
                    setNewCode("");
                    setNewName("");
                    setSearch("");
                    setPage(
                      Math.ceil((draft.task_types.length + 1) / pageSize),
                    );
                  }}
                >
                  Add type
                </Button>
              </div>
              <ERPFilterBar searchSlot={<Input
                aria-label="Search task types"
                placeholder="Search task types"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
              />} />
              <div className="overflow-x-auto">
                <Table className="w-full text-left text-sm">
                  <thead>
                    <tr>
                      {["No.", "Code", "Name", "Category", "Active"].map(
                        (text) => (
                          <th className="p-2" key={text}>
                            {text}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {rows
                      .slice((page - 1) * pageSize, page * pageSize)
                      .map((row, index) => (
                        <tr className="border-t" key={row.value}>
                          <td className="p-2">
                            {(page - 1) * pageSize + index + 1}
                          </td>
                          <td
                            className="p-2 font-mono text-xs"
                            title={
                              savedCodes.has(row.value)
                                ? "Saved code"
                                : undefined
                            }
                          >
                            {row.value}
                          </td>
                          <td className="min-w-48 p-2">
                            <Input
                              aria-label={`Name for ${row.value}`}
                              maxLength={100}
                              value={row.label}
                              onChange={(event) =>
                                editType(row.value, {
                                  label: event.target.value,
                                })
                              }
                            />
                          </td>
                          <td className="min-w-40 p-2">
                            <Input
                              aria-label={`Category for ${row.value}`}
                              maxLength={100}
                              value={row.category}
                              onChange={(event) =>
                                editType(row.value, {
                                  category: event.target.value,
                                })
                              }
                            />
                          </td>
                          <td className="p-2">
                            <input
                              type="checkbox"
                              aria-label={`Active ${row.value}`}
                              checked={row.is_active}
                              onChange={(event) =>
                                editType(row.value, {
                                  is_active: event.target.checked,
                                })
                              }
                            />
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </Table>
              </div>
              <div className="overflow-x-auto">
                <ListingPagination
                  page={page}
                  pageSize={pageSize}
                  totalCount={rows.length}
                  onPage={setPage}
                  onPageSize={(value) => {
                    setPageSize(value);
                    setPage(1);
                  }}
                />
              </div>
            </section>
          </TabsContent>
          <TabsContent value="defaults">
            <section className="grid gap-4 rounded-lg border bg-card p-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="default-task-type">Default task type</Label>
                <Select
                  value={draft.default_task_type}
                  onValueChange={(value) =>
                    update({ default_task_type: value })
                  }
                >
                  <SelectTrigger id="default-task-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {draft.task_types
                      .filter((row) => row.is_active)
                      .map((row) => (
                        <SelectItem key={row.value} value={row.value}>
                          {row.label}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="default-priority">Default priority</Label>
                <Select
                  value={draft.default_priority}
                  onValueChange={(value) => update({ default_priority: value })}
                >
                  <SelectTrigger id="default-priority">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["low", "medium", "high", "critical"].map((value) => (
                      <SelectItem key={value} value={value}>
                        {value}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="default-task-status">New task status</Label>
                <Select
                  value={draft.default_task_status}
                  onValueChange={(value) =>
                    update({ default_task_status: value })
                  }
                >
                  <SelectTrigger id="default-task-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TASK_STATUSES.filter(
                      (row) =>
                        ["draft", "todo"].includes(row.value) &&
                        draft.enabled_task_statuses.includes(row.value),
                    ).map((row) => (
                      <SelectItem key={row.value} value={row.value}>
                        {row.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="default-due-days">Task due after (days)</Label>
                <Input
                  id="default-due-days"
                  type="number"
                  min={0}
                  max={3650}
                  placeholder="No default deadline"
                  value={draft.default_due_days ?? ""}
                  onChange={(event) =>
                    update({
                      default_due_days:
                        event.target.value === ""
                          ? null
                          : Number(event.target.value),
                    })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="default-page-size">Default rows per page</Label>
                <Select
                  value={String(draft.default_page_size)}
                  onValueChange={(value) =>
                    update({ default_page_size: Number(value) })
                  }
                >
                  <SelectTrigger id="default-page-size">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[10, 25, 50, 100].map((value) => (
                      <SelectItem key={value} value={String(value)}>
                        {value} rows
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Used by project and task related-record tables. Users can
                  change their current page size.
                </p>
              </div>
            </section>
          </TabsContent>
          <TabsContent value="statuses">
            <section className="space-y-4 rounded-lg border bg-card p-4">
              <h2 className="font-semibold">Enabled task statuses</h2>
              <p className="text-sm text-muted-foreground">
                Disable optional statuses your organization does not use.
                Existing tasks keep their current status. Approval rules and
                completion/reopen permissions still apply.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {TASK_STATUSES.map((row) => (
                  <label
                    key={row.value}
                    className="flex items-center gap-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={draft.enabled_task_statuses.includes(row.value)}
                      disabled={["todo", "in_progress", "completed"].includes(
                        row.value,
                      )}
                      onChange={(event) => {
                        const enabled = event.target.checked
                          ? [...draft.enabled_task_statuses, row.value]
                          : draft.enabled_task_statuses.filter(
                              (value) => value !== row.value,
                            );
                        update({
                          enabled_task_statuses: enabled,
                          ...(!enabled.includes(draft.default_task_status)
                            ? { default_task_status: "todo" }
                            : {}),
                        });
                      }}
                    />
                    {row.label}
                    {["todo", "in_progress", "completed"].includes(row.value)
                      ? " (required)"
                      : ""}
                  </label>
                ))}
              </div>
            </section>
          </TabsContent>
          <TabsContent value="followups">
            <section className="space-y-4 rounded-lg border bg-card p-4">
              <h2 className="font-semibold">Follow-up defaults</h2>
              <div className="max-w-sm space-y-2">
                <Label htmlFor="default-follow-up-days">
                  Schedule follow-ups after (days)
                </Label>
                <Input
                  id="default-follow-up-days"
                  type="number"
                  min={0}
                  max={3650}
                  value={draft.default_follow_up_days}
                  onChange={(event) =>
                    update({
                      default_follow_up_days: Number(event.target.value),
                    })
                  }
                />
              </div>
              <p className="text-sm text-muted-foreground">
                Sets the suggested date on new follow-ups. Users can choose
                another date. Follow-ups remain linked to their tasks and appear
                in the existing reminders and calendar.
              </p>
            </section>
          </TabsContent>
        </fieldset>
        <TabsContent value="ticket-sync">
          <section className="space-y-4 rounded-lg border bg-card p-4">
            <h2 className="font-semibold">Ticket-to-task status sync</h2>
            <p className="text-sm text-muted-foreground">
              Optionally update a source ticket when its linked task completes.
              This changes ticket status only; it does not move tasks through
              approvals.
            </p>
            {!canManage ? (
              <p className="text-sm">
                An administrator can configure ticket sync.
              </p>
            ) : sync.isError ? (
              <p role="alert">{sync.error.message}</p>
            ) : sync.isLoading ? (
              <p>Loading ticket sync…</p>
            ) : (
              <>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={syncEnabled}
                    onChange={(event) => setSyncEnabled(event.target.checked)}
                  />
                  Enable ticket status sync
                </label>
                <div className="max-w-sm space-y-2">
                  <Label htmlFor="ticket-sync-target">
                    Source ticket status after task completion
                  </Label>
                  <Select value={syncTarget} onValueChange={setSyncTarget}>
                    <SelectTrigger id="ticket-sync-target">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="resolved">Resolved</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  variant="outline"
                  disabled={saveSync.isPending}
                  onClick={() => saveSync.mutate()}
                >
                  Save ticket sync
                </Button>
              </>
            )}
          </section>
        </TabsContent>
      </Tabs>
      {canManage && (
        <div className="sticky bottom-0 flex flex-wrap items-center justify-end gap-3 border-t bg-background p-3">
          <p className="mr-auto text-xs text-muted-foreground">
            Changes affect new work in this organization. Existing task data is
            retained.
          </p>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "Saving…" : "Save project settings"}
          </Button>
        </div>
      )}
    </ERPWorkspacePage>
  )}</ERPListingScope>;
}
