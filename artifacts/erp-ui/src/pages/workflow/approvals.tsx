import { useState } from "react";
import { Bell, Check, Clock3, Eye, RotateCcw, X } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { useAuth } from "@/context/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiErrorFromResponse, formatApiError } from "@/lib/api-errors";

type QueueTab =
  "requests" | "deferred" | "submitted" | "history" | "notifications";
const tabCopy: Record<
  QueueTab,
  { label: string; status?: string; scope?: string; empty: string }
> = {
  requests: {
    label: "Workflow requests",
    status: "pending",
    scope: "assigned",
    empty: "No workflow requests are waiting for your action.",
  },
  deferred: {
    label: "Deferred",
    status: "deferred",
    scope: "assigned",
    empty: "No deferred requests.",
  },
  submitted: {
    label: "My submissions",
    status: "all",
    scope: "submitted",
    empty: "You have not forwarded any workflow requests yet.",
  },
  history: {
    label: "My decisions",
    status: "all",
    scope: "assigned",
    empty: "No completed workflow activity yet.",
  },
  notifications: {
    label: "Notifications",
    empty: "You have no notifications.",
  },
};

export default function WorkflowApprovals() {
  const { token } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<QueueTab>("requests");
  const [acting, setActing] = useState<number | null>(null);
  const [reviewing, setReviewing] = useState<any>(null);
  const [reviewTab, setReviewTab] = useState("summary");
  const [reviewComment, setReviewComment] = useState("");
  const config = tabCopy[tab];
  const queue = useQuery({
    queryKey: ["workflow-approvals", tab, token],
    enabled: !!token && tab !== "notifications",
    queryFn: async () => {
      const params = new URLSearchParams({
        status: config.status || "pending",
        scope: config.scope || "assigned",
        limit: "100",
      });
      const response = await fetch(`/api/platform/workflows/inbox/?${params}`, {
        headers: { Authorization: `Token ${token}` },
      });
      if (!response.ok)
        throw await apiErrorFromResponse(
          response,
          "Unable to load workflow requests.",
        );
      const body = await response.json();
      return body?.data ?? body;
    },
  });
  const notifications = useQuery({
    queryKey: ["workflow-notifications", token],
    enabled: !!token,
    queryFn: async () => {
      const response = await fetch("/api/platform/notifications/?limit=100", {
        headers: { Authorization: `Token ${token}` },
      });
      if (!response.ok)
        throw await apiErrorFromResponse(
          response,
          "Unable to load notifications.",
        );
      const body = await response.json();
      return body?.data ?? body;
    },
  });
  const subject = useQuery({
    queryKey: ["workflow-subject", reviewing?.id, token],
    enabled: !!token && !!reviewing?.id,
    queryFn: async () => {
      const response = await fetch(
        `/api/platform/workflows/inbox/${reviewing.id}/subject/`,
        { headers: { Authorization: `Token ${token}` } },
      );
      if (!response.ok)
        throw await apiErrorFromResponse(
          response,
          "Unable to load workflow review details.",
        );
      const body = await response.json();
      return body?.data ?? body;
    },
  });
  const items = (queue.data?.results ?? []).filter(
    (item: any) =>
      tab !== "history" ||
      ["approved", "rejected", "completed"].includes(item.status),
  );
  const notificationItems = notifications.data?.results ?? [];
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["workflow-approvals"] });
    queryClient.invalidateQueries({ queryKey: ["workflow-notifications"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard-widget-inbox"] });
    queryClient.invalidateQueries({ queryKey: ["workflow-subject"] });
  };
  const act = async (
    id: number,
    decision: "approve" | "reject" | "defer" | "resume" | "comment",
  ) => {
    const reason =
      decision === "defer"
        ? window.prompt("Add a short reason for deferring this request.")
        : "";
    if (decision === "defer" && reason === null) return;
    setActing(id);
    try {
      const response = await fetch(
        `/api/platform/workflows/inbox/${id}/action/`,
        {
          method: "POST",
          headers: {
            Authorization: `Token ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ decision, reason, comment: reviewComment }),
        },
      );
      if (!response.ok)
        throw await apiErrorFromResponse(
          response,
          "The workflow action could not be completed.",
        );
      const body = await response.json();
      toast({ title: body?.message || "Workflow updated" });
      setReviewComment("");
      if (decision !== "comment") setReviewing(null);
      refresh();
    } catch (error) {
      toast({
        title: "Workflow action failed",
        description: formatApiError(error),
        variant: "destructive",
      });
    } finally {
      setActing(null);
    }
  };
  const markRead = async (id?: number) => {
    try {
      const response = await fetch("/api/platform/notifications/", {
        method: "POST",
        headers: {
          Authorization: `Token ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(
          id ? { action: "read", id } : { action: "read_all" },
        ),
      });
      if (!response.ok)
        throw await apiErrorFromResponse(
          response,
          "Unable to update the notification.",
        );
      refresh();
    } catch (error) {
      toast({
        title: "Notification update failed",
        description: formatApiError(error),
        variant: "destructive",
      });
    }
  };
  const snapshot =
    subject.data?.subject?.fields ??
    reviewing?.metadata?.context?.record_snapshot ??
    {};
  const snapshotRows = Object.entries(snapshot).filter(
    ([, value]) => value !== "" && value !== null && value !== undefined,
  );
  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-primary">
            <Bell className="h-4 w-4" /> Workflow runtime
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">
            Workflow Requests
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Review every request assigned to your workflow role across the
            organization. Source-module list filters do not restrict this
            approval queue.
          </p>
        </div>
        <Link href="/platform/workflows">
          <Button variant="outline">Configure workflows</Button>
        </Link>
      </div>
      <Tabs value={tab} onValueChange={(value) => setTab(value as QueueTab)}>
        <TabsList className="h-auto flex-wrap justify-start gap-1 bg-muted/60 p-1">
          {(Object.keys(tabCopy) as QueueTab[]).map((value) => (
            <TabsTrigger key={value} value={value}>
              {tabCopy[value].label}
              {value === "notifications" && notifications.data?.unread_count
                ? ` (${notifications.data.unread_count})`
                : ""}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {tab === "notifications" ? (
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>System notifications</CardTitle>
              <CardDescription>
                Workflow assignments, decisions, and follow-up reminders.
              </CardDescription>
            </div>
            {notifications.data?.unread_count ? (
              <Button variant="outline" size="sm" onClick={() => markRead()}>
                Mark all read
              </Button>
            ) : null}
          </CardHeader>
          <CardContent className="p-0">
            {notifications.isLoading ? (
              <div className="p-8 text-sm text-muted-foreground">
                Loading notifications...
              </div>
            ) : notificationItems.length === 0 ? (
              <div className="p-10 text-center text-sm text-muted-foreground">
                {config.empty}
              </div>
            ) : (
              <div className="divide-y">
                {notificationItems.map((notice: any) => (
                  <div
                    key={notice.id}
                    className={`flex gap-3 p-5 ${notice.is_read ? "" : "bg-primary/5"}`}
                  >
                    <Bell className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{notice.title}</p>
                        {!notice.is_read && <Badge>New</Badge>}
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {notice.message}
                      </p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {new Date(notice.created_at).toLocaleString()}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      {notice.route_path && (
                        <Link href={notice.route_path}>
                          <Button size="sm" variant="outline">
                            Open
                          </Button>
                        </Link>
                      )}
                      {!notice.is_read && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => markRead(notice.id)}
                        >
                          Read
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Records shown</CardDescription>
                <CardTitle className="text-3xl">{items.length}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Selected queue</CardDescription>
                <CardTitle className="text-lg">{config.label}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Unread notifications</CardDescription>
                <CardTitle className="text-3xl">
                  {notifications.data?.unread_count ?? 0}
                </CardTitle>
              </CardHeader>
            </Card>
          </div>
          <Card>
            <CardContent className="p-0">
              {queue.isLoading ? (
                <div className="p-8 text-sm text-muted-foreground">
                  Loading workflow requests...
                </div>
              ) : items.length === 0 ? (
                <div className="p-10 text-center text-sm text-muted-foreground">
                  {config.empty}
                </div>
              ) : (
                <div className="divide-y">
                  {items.map((item: any) => (
                    <div
                      key={item.id}
                      className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="font-semibold">{item.title}</h2>
                          <Badge variant="outline">
                            {item.reference || item.entity_type}
                          </Badge>
                          <Badge
                            variant={
                              item.status === "pending"
                                ? "default"
                                : "secondary"
                            }
                          >
                            {item.status}
                          </Badge>
                        </div>
                        <p className="mt-2 text-sm text-muted-foreground">
                          {item.detail || "No additional details supplied."}
                        </p>
                        <p className="mt-2 text-xs text-muted-foreground">
                          {item.workflow_name || "Workflow"} ·{" "}
                          {item.assigned_group_name ||
                            item.assigned_user_name ||
                            "Assigned approver"}
                          {item.defer_reason
                            ? ` · Deferred: ${item.defer_reason}`
                            : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setReviewing(item);
                            setReviewTab("summary");
                            setReviewComment("");
                          }}
                        >
                          <Eye className="mr-1 h-3.5 w-3.5" />
                          Review
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
      <Dialog
        open={!!reviewing}
        onOpenChange={(open) => !open && setReviewing(null)}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {reviewing?.reference || reviewing?.title || "Workflow request"}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {reviewing?.detail || "No additional details supplied."}
          </p>
          <Tabs value={reviewTab} onValueChange={setReviewTab}>
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="summary">Summary</TabsTrigger>
              <TabsTrigger value="history">History</TabsTrigger>
              <TabsTrigger value="comments">Comments</TabsTrigger>
            </TabsList>
            {reviewTab === "summary" ? (
              <div className="mt-4 space-y-4">
                <div className="grid gap-3 rounded-lg border bg-muted/30 p-3 sm:grid-cols-2">
                  <div>
                    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Current approval stage
                    </div>
                    <div className="mt-1 font-medium">
                      {subject.data?.current_stage ||
                        reviewing?.workflow_name ||
                        "Workflow review"}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Approver role
                    </div>
                    <div className="mt-1 font-medium">
                      {subject.data?.current_role ||
                        reviewing?.assigned_group_name ||
                        reviewing?.assigned_user_name ||
                        "Unassigned"}
                    </div>
                  </div>
                </div>
                {subject.isLoading ? (
                  <div className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">
                    Loading current record details...
                  </div>
                ) : null}
                {snapshotRows.length ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {snapshotRows.map(([key, value]) => (
                      <div key={key} className="rounded-lg border p-3">
                        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          {key.replace(/_/g, " ")}
                        </div>
                        <div className="mt-1 font-medium">{String(value)}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">
                    This older request has no saved document snapshot. You can
                    still review its workflow history and take a decision.
                  </div>
                )}
              </div>
            ) : null}
            {reviewTab === "history" ? (
              <div className="mt-4 space-y-3">
                {(subject.data?.workflow_history || []).length ? (
                  (subject.data.workflow_history as any[]).map(
                    (event, index) => (
                      <div
                        key={`${event.at}-${index}`}
                        className="rounded-lg border p-3"
                      >
                        <div className="flex justify-between gap-3">
                          <span className="font-medium capitalize">
                            {event.action}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {event.at
                              ? new Date(event.at).toLocaleString()
                              : ""}
                          </span>
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {event.actor}
                          {event.role ? ` · ${event.role}` : ""}
                          {event.stage ? ` · ${event.stage}` : ""}
                        </p>
                        {event.comment ? (
                          <p className="mt-2 text-sm">{event.comment}</p>
                        ) : null}
                      </div>
                    ),
                  )
                ) : (
                  <div className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">
                    No workflow activity has been recorded yet.
                  </div>
                )}
              </div>
            ) : null}
            {reviewTab === "comments" ? (
              <div className="mt-4 space-y-4">
                <div className="space-y-3">
                  {(subject.data?.workflow_history || []).filter(
                    (event: any) => event.comment,
                  ).length ? (
                    (subject.data.workflow_history as any[])
                      .filter((event) => event.comment)
                      .map((event, index) => (
                        <div
                          key={`${event.at}-${index}`}
                          className="rounded-lg border p-3"
                        >
                          <p className="text-sm">{event.comment}</p>
                          <p className="mt-2 text-xs text-muted-foreground">
                            {event.actor} ·{" "}
                            {event.at
                              ? new Date(event.at).toLocaleString()
                              : ""}
                          </p>
                        </div>
                      ))
                  ) : (
                    <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                      No comments have been added yet.
                    </p>
                  )}
                </div>
                <Textarea
                  value={reviewComment}
                  onChange={(event) => setReviewComment(event.target.value)}
                  placeholder="Add a comment for the next approver or audit trail..."
                />
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => act(reviewing.id, "comment")}
                    disabled={!reviewComment.trim() || acting === reviewing.id}
                  >
                    Add comment
                  </Button>
                </div>
              </div>
            ) : null}
          </Tabs>
          {reviewing?.status === "pending" && tab === "requests" ? (
            <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
              <Button
                onClick={() => act(reviewing.id, "approve")}
                disabled={acting === reviewing.id}
              >
                <Check className="mr-1 h-3.5 w-3.5" />
                Approve
              </Button>
              <Button
                variant="outline"
                onClick={() => act(reviewing.id, "defer")}
                disabled={acting === reviewing.id}
              >
                <Clock3 className="mr-1 h-3.5 w-3.5" />
                Defer
              </Button>
              <Button
                variant="outline"
                className="text-destructive"
                onClick={() => act(reviewing.id, "reject")}
                disabled={acting === reviewing.id}
              >
                <X className="mr-1 h-3.5 w-3.5" />
                Reject
              </Button>
            </div>
          ) : null}
          {reviewing?.status === "deferred" ? (
            <div className="flex justify-end border-t pt-4">
              <Button
                onClick={() => act(reviewing.id, "resume")}
                disabled={acting === reviewing.id}
              >
                <RotateCcw className="mr-1 h-3.5 w-3.5" />
                Resume
              </Button>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
