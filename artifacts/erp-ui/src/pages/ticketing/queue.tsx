import type { IntakeForm } from "@/components/ticketing/form-schema";
/* Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu. */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageSquare, Plus, Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ERPFormDialog } from "@/components/erp/forms/form-dialog";
import { ERPFilterBar } from "@/components/erp/listing/filter-bar";
import {
  ERPDataTable,
  type ERPTableColumn,
} from "@/components/erp/listing/data-table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/context/use-auth";
import { useToast } from "@/hooks/use-toast";
import { apiErrorFromResponse } from "@/lib/api-errors";
import {
  CreateAgentTicketDialog,
  type CreatedAgentTicket,
  type RequesterDefaults,
} from "@/components/ticketing/create-ticket-dialog";

type TicketRow = {
  id: number;
  public_id: string;
  subject: string;
  requester_name?: string;
  requester_email: string;
  project_name?: string;
  project?: number | null;
  description?: string;
  priority: string;
  status: string;
  assigned_to_name?: string;
  source_channel?: string;
  timeline?: Array<{
    kind: string;
    author_name?: string;
    author_type?: string;
    summary?: string;
    message?: string;
    direction?: string;
    channel?: string;
    delivery_status?: string;
    payload?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  }>;
};
type LinkedTask = {
  id: number;
  number: string;
  title: string;
  status: string;
  priority: string;
  due_date: string | null;
  primary_assignee: number | null;
};

function authFetch(token: string, path: string, init?: RequestInit) {
  return fetch(path, {
    ...init,
    headers: {
      Authorization: `Token ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

export default function TicketingQueue() {
  const { token, user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [createTicketOpen, setCreateTicketOpen] = useState(false);
  const [projectSearch, setProjectSearch] = useState("");
  const queueContext = [
    token,
    user?.organization_id,
    user?.active_membership_id,
    user?.branch_id,
    user?.active_role_group_name,
  ];
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [reply, setReply] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "new" | "open" | "pending" | "resolved" | "closed"
  >("all");
  const [priorityFilter, setPriorityFilter] = useState<
    "all" | "low" | "normal" | "high" | "urgent"
  >("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDescription, setTaskDescription] = useState("");
  const [taskPriority, setTaskPriority] = useState("medium");
  const [taskDueDate, setTaskDueDate] = useState("");
  const [taskType, setTaskType] = useState("");
  const [replyChannel, setReplyChannel] = useState<
    "portal" | "email" | "whatsapp"
  >("portal");

  const creationOptions = useQuery<{
    can_create: boolean;
    can_change: boolean;
    requester_defaults: RequesterDefaults;
    forms: IntakeForm[];
    project_names: string[];
  }>({
    queryKey: ["ticketing-create-options", ...queueContext],
    enabled: !!token,
    queryFn: async () => {
      const response = await authFetch(
        token!,
        "/api/ticketing/tickets/options/",
      );
      if (!response.ok)
        throw await apiErrorFromResponse(
          response,
          "Ticket creation options could not be loaded.",
        );
      return response.json();
    },
  });
  const projectSuggestions = useQuery<string[]>({
    queryKey: ["ticketing-project-suggestions", ...queueContext, projectSearch],
    enabled: !!token && createTicketOpen && !!projectSearch.trim(),
    queryFn: async ({ signal }) => {
      const response = await authFetch(
        token!,
        `/api/ticketing/tickets/options/?project_search=${encodeURIComponent(projectSearch)}`,
        { signal },
      );
      if (!response.ok) throw await apiErrorFromResponse(response);
      const data = await response.json();
      return data.project_names;
    },
  });
  const ticketCreated = (ticket: CreatedAgentTicket) => {
    const nextKey = ["ticketing-queue", ...queueContext, "", "all", "all"];
    qc.setQueryData<TicketRow[]>(nextKey, (current) => [
      ticket,
      ...(current ?? []).filter((row) => row.id !== ticket.id),
    ]);
    setSearch("");
    setStatusFilter("all");
    setPriorityFilter("all");
    setSelectedId(ticket.id);
    setCreateTicketOpen(false);
    setDialogOpen(true);
    void qc.invalidateQueries({ queryKey: ["ticketing-queue"] });
    void qc.invalidateQueries({ queryKey: ["ticketing-dashboard"] });
  };
  const {
    data,
    isLoading,
    error: queueError,
  } = useQuery<TicketRow[]>({
    queryKey: [
      "ticketing-queue",
      ...queueContext,
      search,
      statusFilter,
      priorityFilter,
    ],
    enabled: !!token,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search.trim()) params.set("search", search.trim());
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (priorityFilter !== "all") params.set("priority", priorityFilter);
      const query = params.toString();
      const res = await authFetch(
        token!,
        `/api/ticketing/tickets/${query ? `?${query}` : ""}`,
      );
      if (!res.ok) throw new Error("Failed to load tickets");
      return res.json();
    },
  });

  const tickets = data ?? [];
  const counts = useMemo(
    () => ({
      total: tickets.length,
      open: tickets.filter((ticket) =>
        ["new", "open", "pending"].includes(ticket.status),
      ).length,
      resolved: tickets.filter((ticket) => ticket.status === "resolved").length,
      urgent: tickets.filter((ticket) => ticket.priority === "urgent").length,
    }),
    [tickets],
  );
  const selectedTicket = useMemo(
    () => tickets.find((ticket) => ticket.id === selectedId) ?? null,
    [selectedId, tickets],
  );
  useEffect(() => {
    setReply("");
    setReplyChannel("portal");
  }, [selectedId]);

  const linkedTasks = useQuery<LinkedTask[]>({
    queryKey: ["ticket-project-tasks", ...queueContext, selectedTicket?.id],
    enabled: !!token && !!selectedTicket,
    queryFn: async () => {
      const response = await authFetch(
        token!,
        `/api/projects/tickets/${selectedTicket!.id}/tasks/`,
      );
      if (!response.ok) throw new Error("Linked tasks could not be loaded.");
      return response.json();
    },
  });

  const availableReplyChannels = useMemo(() => {
    if (!selectedTicket)
      return ["portal"] as Array<"portal" | "email" | "whatsapp">;
    const channels: Array<"portal" | "email" | "whatsapp"> = [
      "portal",
      "email",
    ];
    if (
      selectedTicket.source_channel === "whatsapp" ||
      selectedTicket.requester_email?.endsWith("@whatsapp.local")
    ) {
      channels.push("whatsapp");
    }
    return channels;
  }, [selectedTicket]);

  useEffect(() => {
    if (!availableReplyChannels.includes(replyChannel)) {
      setReplyChannel(availableReplyChannels[0]);
    }
  }, [availableReplyChannels, replyChannel]);

  const columns: ERPTableColumn<TicketRow>[] = [
    {
      key: "ticket",
      label: "Ticket",
      render: (row) => (
        <div>
          <div className="font-medium">{row.subject}</div>
          <div className="text-xs text-muted-foreground">{row.public_id}</div>
        </div>
      ),
    },
    {
      key: "requester",
      label: "Requester",
      render: (row) => (
        <div>
          <div className="text-sm">
            {row.requester_name || row.requester_email}
          </div>
          <div className="text-xs text-muted-foreground">
            {row.requester_email}
          </div>
        </div>
      ),
    },
    {
      key: "priority",
      label: "Priority",
      render: (row) => <Badge>{row.priority}</Badge>,
    },
    {
      key: "status",
      label: "Status",
      render: (row) => <Badge variant="outline">{row.status}</Badge>,
    },
    {
      key: "assignee",
      label: "Assigned To",
      render: (row) => (
        <span className="text-sm text-muted-foreground">
          {row.assigned_to_name || "Unassigned"}
        </span>
      ),
    },
  ];

  const replyMutation = useMutation({
    mutationFn: async () => {
      if (!selectedTicket) return null;
      const res = await authFetch(
        token!,
        `/api/ticketing/tickets/${selectedTicket.id}/reply/`,
        {
          method: "POST",
          body: JSON.stringify({
            message: reply,
            is_public: true,
            reply_channel: replyChannel,
          }),
        },
      );
      if (!res.ok) throw new Error("Failed to send reply");
      return res.json();
    },
    onSuccess: () => {
      setReply("");
      setReplyChannel("portal");
      qc.invalidateQueries({ queryKey: ["ticketing-queue"] });
    },
  });

  const statusMutation = useMutation({
    mutationFn: async (nextStatus: string) => {
      if (!selectedTicket) return null;
      const res = await authFetch(
        token!,
        `/api/ticketing/tickets/${selectedTicket.id}/`,
        {
          method: "PATCH",
          body: JSON.stringify({ status: nextStatus }),
        },
      );
      if (!res.ok) throw new Error("Failed to update ticket");
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ticketing-queue"] }),
  });

  const createTaskMutation = useMutation({
    mutationFn: async () => {
      if (!selectedTicket) return null;
      const response = await authFetch(
        token!,
        `/api/projects/tickets/${selectedTicket.id}/tasks/`,
        {
          method: "POST",
          body: JSON.stringify({
            title: taskTitle,
            description: taskDescription,
            priority: taskPriority,
            due_date: taskDueDate || null,
            task_type: taskType,
          }),
        },
      );
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(
          body.detail || "Task could not be created from this ticket.",
        );
      }
      return response.json() as Promise<{ number: string }>;
    },
    onSuccess: (task) => {
      if (task) {
        setTaskDialogOpen(false);
        setTaskTitle("");
        setTaskDescription("");
        setTaskDueDate("");
        setTaskType("");
        void qc.invalidateQueries({
          queryKey: [
            "ticket-project-tasks",
            ...queueContext,
            selectedTicket?.id,
          ],
        });
        toast({
          title: "Draft task created",
          description: `${task.number} is linked to this ticket.`,
        });
      }
    },
    onError: (error: Error) =>
      toast({
        title: "Could not create task",
        description: error.message,
        variant: "destructive",
      }),
  });

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">
            Support Tickets
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage requests, reply to customers, and track linked project tasks.
          </p>
        </div>
        {creationOptions.data?.can_create && (
          <Button onClick={() => setCreateTicketOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            New Ticket
          </Button>
        )}
      </div>
      {creationOptions.isError && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 text-sm text-destructive"
        >
          <span>{creationOptions.error.message}</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void creationOptions.refetch()}
          >
            Retry
          </Button>
        </div>
      )}
      {queueError && (
        <p role="alert" className="text-sm text-destructive">
          {queueError.message}
        </p>
      )}
      {creationOptions.data?.can_create && (
        <CreateAgentTicketDialog
          open={createTicketOpen}
          onOpenChange={setCreateTicketOpen}
          defaults={creationOptions.data.requester_defaults}
          forms={creationOptions.data.forms}
          projectNames={
            projectSuggestions.data || creationOptions.data.project_names
          }
          onProjectSearch={setProjectSearch}
          onCreated={ticketCreated}
        />
      )}

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-semibold">{counts.total}</div>
            <div className="text-sm text-muted-foreground">Loaded Tickets</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-semibold">{counts.open}</div>
            <div className="text-sm text-muted-foreground">Open Tickets</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-semibold">{counts.resolved}</div>
            <div className="text-sm text-muted-foreground">Resolved</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-semibold">{counts.urgent}</div>
            <div className="text-sm text-muted-foreground">Urgent</div>
          </CardContent>
        </Card>
      </div>

      <ERPFilterBar
        searchSlot={
          <div className="relative w-full">
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Search by subject, requester email, or ticket ID"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        }
        filterSlot={
          <div className="flex flex-wrap items-center gap-3">
            <Select
              value={statusFilter}
              onValueChange={(value: typeof statusFilter) =>
                setStatusFilter(value)
              }
            >
              <SelectTrigger className="w-[170px]">
                <SelectValue placeholder="Ticket Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="new">New</SelectItem>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="resolved">Resolved</SelectItem>
                <SelectItem value="closed">Closed</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={priorityFilter}
              onValueChange={(value: typeof priorityFilter) =>
                setPriorityFilter(value)
              }
            >
              <SelectTrigger className="w-[170px]">
                <SelectValue placeholder="Priority Level" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Priorities</SelectItem>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="normal">Normal</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="urgent">Urgent</SelectItem>
              </SelectContent>
            </Select>
          </div>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Ticket Register</CardTitle>
        </CardHeader>
        <CardContent>
          <ERPDataTable
            columns={columns}
            rows={tickets}
            loading={isLoading}
            loadingLabel="Loading ticket queue…"
            emptyState="No tickets match the current filters."
            onRowClick={(row) => {
              setSelectedId(row.id);
              setDialogOpen(true);
            }}
            rowActions={(row) => (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSelectedId(row.id);
                  setDialogOpen(true);
                }}
              >
                <MessageSquare className="h-4 w-4" />
              </Button>
            )}
          />
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="flex h-[92dvh] max-h-[92dvh] w-[calc(100%-1rem)] max-w-[1440px] flex-col gap-0 overflow-hidden p-0 sm:w-[calc(100%-3rem)]">
          <DialogHeader className="shrink-0 border-b px-4 py-4 pr-12 text-left sm:px-6">
            <DialogDescription className="break-all font-mono text-xs">
              {selectedTicket?.public_id || "Support ticket"}
            </DialogDescription>
            <DialogTitle className="break-words text-xl leading-snug">
              {selectedTicket?.subject || "Ticket details"}
            </DialogTitle>
            {selectedTicket && (
              <div className="flex flex-wrap gap-2 pt-2">
                <Badge variant="outline" className="capitalize">
                  {selectedTicket.status}
                </Badge>
                <Badge variant="secondary" className="capitalize">
                  {selectedTicket.priority} priority
                </Badge>
              </div>
            )}
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
            {!selectedTicket ? (
              <p className="text-sm text-muted-foreground">
                Choose a ticket to view its details.
              </p>
            ) : (
              <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
                <div className="min-w-0 space-y-5">
                  <section
                    className="rounded-lg border p-4"
                    aria-label="Request description"
                  >
                    <h3 className="text-sm font-semibold">Request</h3>
                    <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">
                      {selectedTicket.description || "No description supplied."}
                    </p>
                  </section>
                  <Tabs
                    key={selectedTicket.id}
                    defaultValue="conversation"
                    className="min-w-0"
                  >
                    <TabsList className="grid h-auto w-full grid-cols-1 gap-1 sm:grid-cols-3">
                      <TabsTrigger value="conversation">
                        Conversation
                      </TabsTrigger>
                      <TabsTrigger value="tasks">
                        Linked tasks ({linkedTasks.data?.length ?? 0})
                      </TabsTrigger>
                      <TabsTrigger value="activity">Activity</TabsTrigger>
                    </TabsList>
                    <TabsContent
                      value="conversation"
                      className="space-y-5 pt-2"
                    >
                      <section aria-label="Conversation" className="space-y-3">
                        {(selectedTicket.timeline ?? [])
                          .filter((item) => item.kind === "message")
                          .map((item, index) => (
                            <article
                              key={index}
                              className="min-w-0 rounded-lg border p-4 text-sm"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="break-words font-medium">
                                  {item.author_name ||
                                    item.author_type ||
                                    "Requester"}
                                </span>
                                <div className="flex flex-wrap gap-2">
                                  <Badge
                                    variant="outline"
                                    className="capitalize"
                                  >
                                    {item.channel || "portal"}
                                  </Badge>
                                  {item.direction && (
                                    <Badge
                                      variant="secondary"
                                      className="capitalize"
                                    >
                                      {item.direction}
                                    </Badge>
                                  )}
                                  {item.delivery_status && (
                                    <Badge
                                      variant="secondary"
                                      className="capitalize"
                                    >
                                      {item.delivery_status}
                                    </Badge>
                                  )}
                                </div>
                              </div>
                              <p className="mt-3 whitespace-pre-wrap break-words leading-relaxed text-muted-foreground">
                                {item.message}
                              </p>
                            </article>
                          ))}
                        {!(selectedTicket.timeline ?? []).some(
                          (item) => item.kind === "message",
                        ) && (
                          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                            No messages yet. Send a reply below to start the
                            conversation.
                          </p>
                        )}
                      </section>
                      <section
                        aria-label="Reply to requester"
                        className="space-y-4 rounded-lg border bg-muted/20 p-4"
                      >
                        <div className="flex flex-wrap items-end justify-between gap-3">
                          <h3 className="text-sm font-semibold">
                            Reply to requester
                          </h3>
                          <div className="w-full space-y-2 sm:w-44">
                            <Label htmlFor="ticket-reply-channel">
                              Send through
                            </Label>
                            <Select
                              value={replyChannel}
                              onValueChange={(
                                value: "portal" | "email" | "whatsapp",
                              ) => setReplyChannel(value)}
                            >
                              <SelectTrigger
                                id="ticket-reply-channel"
                                className="capitalize"
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {availableReplyChannels.map((channel) => (
                                  <SelectItem
                                    key={channel}
                                    value={channel}
                                    className="capitalize"
                                  >
                                    {channel}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="ticket-reply">Message</Label>
                          <Textarea
                            id="ticket-reply"
                            value={reply}
                            onChange={(e) => setReply(e.target.value)}
                            placeholder="Write a response to the requester"
                            rows={4}
                          />
                        </div>
                        {replyMutation.isError && (
                          <p role="alert" className="text-sm text-destructive">
                            {replyMutation.error.message}
                          </p>
                        )}
                        <div className="flex justify-end">
                          <Button
                            onClick={() => replyMutation.mutate()}
                            disabled={!reply.trim() || replyMutation.isPending}
                          >
                            {replyMutation.isPending
                              ? "Sending…"
                              : "Send reply"}
                          </Button>
                        </div>
                      </section>
                    </TabsContent>
                    <TabsContent value="tasks" className="space-y-3 pt-2">
                      {linkedTasks.isLoading ? (
                        <p className="text-sm text-muted-foreground">
                          Loading linked tasks…
                        </p>
                      ) : linkedTasks.isError ? (
                        <div
                          role="alert"
                          className="space-y-2 text-sm text-destructive"
                        >
                          <p>{linkedTasks.error.message}</p>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void linkedTasks.refetch()}
                          >
                            Retry
                          </Button>
                        </div>
                      ) : linkedTasks.data?.length ? (
                        linkedTasks.data.map((task) => (
                          <div
                            className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-lg border p-4 text-sm"
                            key={task.id}
                          >
                            <div className="min-w-0 flex-1 basis-48">
                              <span className="font-mono text-xs text-muted-foreground">
                                {task.number}
                              </span>
                              <div className="mt-1 break-words font-medium">
                                {task.title}
                              </div>
                              {task.due_date && (
                                <p className="mt-2 text-xs text-muted-foreground">
                                  Due: {task.due_date}
                                </p>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <Badge variant="outline" className="capitalize">
                                {task.priority}
                              </Badge>
                              <Badge variant="secondary" className="capitalize">
                                {task.status.replaceAll("_", " ")}
                              </Badge>
                            </div>
                          </div>
                        ))
                      ) : (
                        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                          No tasks linked yet. Use Create task to add one.
                        </p>
                      )}
                    </TabsContent>
                    <TabsContent value="activity" className="space-y-3 pt-2">
                      {(selectedTicket.timeline ?? [])
                        .filter((item) => item.kind !== "message")
                        .map((item, index) => (
                          <article
                            key={index}
                            className="min-w-0 rounded-lg border p-4 text-sm"
                          >
                            <h3 className="break-words font-medium">
                              {item.summary || item.kind.replaceAll("_", " ")}
                            </h3>
                            {Object.keys(item.payload ?? {}).length > 0 && (
                              <dl className="mt-3 space-y-2">
                                {Object.entries(item.payload ?? {}).map(
                                  ([key, value]) => (
                                    <div
                                      key={key}
                                      className="grid gap-1 sm:grid-cols-[8rem_minmax(0,1fr)]"
                                    >
                                      <dt className="break-words capitalize text-muted-foreground">
                                        {key.replaceAll("_", " ")}
                                      </dt>
                                      <dd className="break-words">
                                        {typeof value === "object" &&
                                        value !== null
                                          ? JSON.stringify(value)
                                          : String(value ?? "—")}
                                      </dd>
                                    </div>
                                  ),
                                )}
                              </dl>
                            )}
                          </article>
                        ))}
                      {!(selectedTicket.timeline ?? []).some(
                        (item) => item.kind !== "message",
                      ) && (
                        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                          No activity recorded yet.
                        </p>
                      )}
                    </TabsContent>
                  </Tabs>
                </div>
                <aside
                  aria-label="Ticket details"
                  className="min-w-0 space-y-5 rounded-lg border bg-muted/20 p-4"
                >
                  <h3 className="font-semibold">Ticket details</h3>
                  <dl className="space-y-4 text-sm">
                    <div>
                      <dt className="text-muted-foreground">Requester</dt>
                      <dd className="mt-1 break-words font-medium">
                        {selectedTicket.requester_name ||
                          selectedTicket.requester_email}
                      </dd>
                      {selectedTicket.requester_name && (
                        <dd className="mt-1 break-all text-muted-foreground">
                          {selectedTicket.requester_email}
                        </dd>
                      )}
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Assigned to</dt>
                      <dd className="mt-1 break-words">
                        {selectedTicket.assigned_to_name || "Unassigned"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Project</dt>
                      <dd className="mt-1 break-words">
                        {selectedTicket.project_name || "No project"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Source</dt>
                      <dd className="mt-1 capitalize">
                        {selectedTicket.source_channel || "portal"}
                      </dd>
                    </div>
                  </dl>
                  <div className="space-y-2 border-t pt-4">
                    <Label htmlFor="ticket-status">Status</Label>
                    <Select
                      value={selectedTicket.status}
                      onValueChange={(value) => statusMutation.mutate(value)}
                      disabled={
                        !creationOptions.data?.can_change ||
                        statusMutation.isPending
                      }
                    >
                      <SelectTrigger id="ticket-status" className="capitalize">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[
                          ...new Set([
                            selectedTicket.status,
                            "open",
                            "pending",
                            "resolved",
                            "closed",
                          ]),
                        ].map((status) => (
                          <SelectItem
                            key={status}
                            value={status}
                            className="capitalize"
                          >
                            {status}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {statusMutation.isPending && (
                      <p
                        role="status"
                        className="text-xs text-muted-foreground"
                      >
                        Saving status…
                      </p>
                    )}
                    {statusMutation.isError && (
                      <p role="alert" className="text-sm text-destructive">
                        {statusMutation.error.message}
                      </p>
                    )}
                  </div>
                  <Button
                    className="w-full"
                    variant="outline"
                    onClick={() => {
                      setTaskTitle(selectedTicket.subject);
                      setTaskDescription(selectedTicket.description || "");
                      setTaskPriority(
                        selectedTicket.priority === "urgent"
                          ? "critical"
                          : selectedTicket.priority === "normal"
                            ? "medium"
                            : selectedTicket.priority,
                      );
                      setTaskDialogOpen(true);
                    }}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Create task
                  </Button>
                </aside>
              </div>
            )}
          </div>
          <DialogFooter className="shrink-0 border-t px-4 py-3 sm:px-6">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ERPFormDialog
        open={taskDialogOpen}
        onOpenChange={setTaskDialogOpen}
        title="Create Task from Ticket"
        maxWidthClassName="w-[calc(100%-1rem)] max-w-3xl"
        footer={
          <div className="flex w-full justify-end gap-2">
            <Button variant="outline" onClick={() => setTaskDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!taskTitle.trim() || createTaskMutation.isPending}
              onClick={() => createTaskMutation.mutate()}
            >
              {createTaskMutation.isPending
                ? "Creating task..."
                : "Create Draft Task"}
            </Button>
          </div>
        }
      >
        <div className="grid gap-4">
          <div className="space-y-2">
            <Label htmlFor="ticket-task-title">Task title</Label>
            <Input
              id="ticket-task-title"
              value={taskTitle}
              onChange={(event) => setTaskTitle(event.target.value)}
              placeholder="Task title"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ticket-task-description">Description</Label>
            <Textarea
              id="ticket-task-description"
              value={taskDescription}
              onChange={(event) => setTaskDescription(event.target.value)}
              placeholder="Task description"
              rows={5}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="min-w-0 space-y-2">
              <Label htmlFor="ticket-task-type">Task type</Label>
              <Input
                id="ticket-task-type"
                value={taskType}
                onChange={(event) => setTaskType(event.target.value)}
                placeholder="Task type"
              />
            </div>
            <div className="min-w-0 space-y-2">
              <Label htmlFor="ticket-task-priority">Priority</Label>
              <Select value={taskPriority} onValueChange={setTaskPriority}>
                <SelectTrigger id="ticket-task-priority">
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
              <Label htmlFor="ticket-task-due">Due date</Label>
              <Input
                id="ticket-task-due"
                className="min-w-0"
                value={taskDueDate}
                onChange={(event) => setTaskDueDate(event.target.value)}
                type="date"
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            The source ticket remains unchanged. The new task will be created as
            a draft in your active branch.
          </p>
        </div>
      </ERPFormDialog>
    </div>
  );
}
