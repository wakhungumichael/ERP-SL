/* Copyright (c) 2026 Siakora Labs Limited. */
import {
  Bell,
  CheckSquare2,
  Workflow,
  ArrowRight,
  RefreshCw,
  LayoutDashboard,
  Clock3,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/context/use-auth";
import { useWorkspace, useWorkspaceTab } from "@/context/workspace-context";
import { useTenantTheme } from "@/hooks/use-tenant-theme";
import { useDashboardAccess } from "@/hooks/use-dashboard-access";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { apiErrorFromResponse } from "@/lib/api-errors";

type Activity = {
  available: boolean;
  count: number;
  results: Array<Record<string, any>>;
};
export default function WorkspaceHome() {
  const { token, user } = useAuth();
  const { tenantContext } = useTenantTheme({ applyTheme: false });
  const workspace = useWorkspace()!;
  const view = useWorkspaceTab();
  const { hasPermission } = useDashboardAccess();
  const [, navigate] = useLocation();
  const scope = [
    user?.id,
    user?.organization_id,
    user?.branch_id,
    user?.active_role_group_name,
  ];
  const fetchActivity = async (path: string): Promise<Activity> => {
    const response = await fetch(path, {
      headers: { Authorization: `Token ${token}` },
    });
    if (response.status === 403 || response.status === 404)
      return { available: false, count: 0, results: [] };
    if (!response.ok) throw await apiErrorFromResponse(response);
    const json = await response.json();
    const data = json?.data ?? json;
    const results = Array.isArray(data?.results) ? data.results : [];
    return {
      available: true,
      count: Number(
        data.unread_count ??
          data.count ??
          data.pagination?.total_count ??
          results.length,
      ),
      results,
    };
  };
  const enabled = Boolean(token && (!view || view.active));
  const notices = useQuery({
    queryKey: ["home-notices", ...scope, token],
    queryFn: () =>
      fetchActivity("/api/platform/notifications/?unread=1&page=1&page_size=6"),
    enabled,
    refetchInterval: enabled ? 60_000 : false,
  });
  const approvals = useQuery({
    queryKey: ["home-approvals", ...scope, token],
    queryFn: () =>
      fetchActivity(
        "/api/platform/workflows/inbox/?scope=assigned&status=pending&page=1&page_size=6",
      ),
    enabled,
    refetchInterval: enabled ? 60_000 : false,
  });
  const projectsEnabled =
    tenantContext.activeModuleSlugs.includes("projects-tasks");
  const tasks = useQuery({
    queryKey: ["home-tasks", ...scope, token],
    queryFn: () =>
      fetchActivity(
        "/api/projects/tasks/?scope=mine&page=1&page_size=6&ordering=due_date",
      ),
    enabled: enabled && projectsEnabled,
    refetchInterval: enabled && projectsEnabled ? 60_000 : false,
  });
  const sections = [
    {
      key: "notices",
      title: "Notifications",
      description: "Notices and reminders",
      icon: Bell,
      query: notices,
      path: "/workflows/approvals?tab=notifications",
      route: "/workflows/approvals",
      visible: true,
    },
    {
      key: "approvals",
      title: "Workflow activities",
      description: "Requests waiting for your decision",
      icon: Workflow,
      query: approvals,
      path: "/workflows/approvals",
      route: "/workflows/approvals",
      visible: true,
    },
    {
      key: "tasks",
      title: "My tasks",
      description: "Work assigned to you",
      icon: CheckSquare2,
      query: tasks,
      path: "/projects/my-tasks",
      route: "/projects/tasks",
      visible: projectsEnabled,
    },
  ].filter((section) => section.visible);
  const name = String(user?.first_name || tenantContext.displayName || "there");
  return (
    <div className="mx-auto w-full max-w-7xl space-y-5" data-workspace-home>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b pb-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-primary">
            {tenantContext.tenantName}
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            Welcome, {name}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your activities and assigned work, in one place.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              sections.forEach((section) => section.query.refetch())
            }
            aria-label="Refresh Home"
          >
            <RefreshCw className="h-4 w-4" />
            <span>Refresh</span>
          </Button>
          {hasPermission("view_dashboard") ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate("/dashboard")}
            >
              <LayoutDashboard className="h-4 w-4" />
              Dashboard
            </Button>
          ) : null}
        </div>
      </header>
      <div className="grid gap-3 sm:grid-cols-3">
        {sections.map(
          ({ key, title, description, icon: Icon, query, path }) => (
            <button
              key={key}
              type="button"
              disabled={query.isError || query.data?.available === false}
              onClick={() => navigate(path)}
              className="flex min-w-0 items-center gap-4 rounded-xl border border-primary/15 bg-card p-4 text-left shadow-sm transition-colors hover:border-primary/50 disabled:cursor-default"
            >
              <span className="rounded-xl bg-primary/10 p-3 text-primary">
                <Icon className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{title}</span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {description}
                </span>
              </span>
              <span className="text-2xl font-semibold tabular-nums">
                {query.isPending
                  ? "..."
                  : query.isError || query.data?.available === false
                    ? "-"
                    : (query.data?.count ?? 0)}
              </span>
            </button>
          ),
        )}
      </div>
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(16rem,1fr)]">
        <section
          className="overflow-hidden rounded-xl border bg-card"
          aria-labelledby="home-activities-title"
        >
          <h2
            id="home-activities-title"
            className="border-b bg-primary/5 px-4 py-3 text-sm font-semibold"
          >
            Activities
          </h2>
          {sections.map(({ key, title, query, path, route, icon: Icon }) => (
            <details
              key={key}
              open={key === "approvals"}
              className="group border-b last:border-b-0"
            >
              <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 hover:bg-muted/40">
                <Icon className="h-4 w-4 text-primary" />
                <span className="flex-1 text-sm font-medium">{title}</span>
                <Badge variant="secondary">{query.data?.count ?? 0}</Badge>
                <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-90" />
              </summary>
              <div className="border-t bg-muted/10">
                {query.isPending ? (
                  <p className="p-4 text-sm text-muted-foreground">
                    Loading activities...
                  </p>
                ) : query.isError ? (
                  <div className="p-4 text-sm" role="alert">
                    Unable to load these activities.{" "}
                    <button
                      type="button"
                      className="text-primary underline"
                      onClick={() => query.refetch()}
                    >
                      Try again
                    </button>
                  </div>
                ) : query.data?.available === false ? (
                  <p className="p-4 text-sm text-muted-foreground">
                    These activities are not available to your current role.
                  </p>
                ) : !query.data?.results.length ? (
                  <p className="p-4 text-sm text-muted-foreground">
                    Nothing is waiting for you here.
                  </p>
                ) : (
                  <div className="divide-y">
                    {query.data.results.map((item) => (
                      <button
                        type="button"
                        key={item.id}
                        onClick={() =>
                          navigate(
                            key === "tasks"
                              ? `${route}/${item.id}`
                              : item.route_path || route,
                          )
                        }
                        className="block w-full px-4 py-3 text-left hover:bg-primary/5"
                      >
                        <span className="block text-sm font-medium">
                          {item.title || item.reference || "Workflow request"}
                        </span>
                        <span className="mt-1 block truncate text-xs text-muted-foreground">
                          {item.message ||
                            item.detail ||
                            item.number ||
                            item.status?.replaceAll("_", " ")}
                          {item.due_date ? ` - Due ${item.due_date}` : ""}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {query.data?.available ? (
                  <button
                    type="button"
                    className="flex w-full items-center justify-between border-t px-4 py-3 text-sm font-medium text-primary hover:bg-primary/5"
                    onClick={() => navigate(path)}
                  >
                    View all {title.toLowerCase()}
                    <ArrowRight className="h-4 w-4" />
                  </button>
                ) : null}
              </div>
            </details>
          ))}
        </section>
        <div className="space-y-4">
          <section className="rounded-xl border bg-card p-4">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <Clock3 className="h-4 w-4 text-primary" />
              Open workspaces
            </h2>
            <div className="space-y-1">
              {workspace.state.tabs
                .filter((tab) => tab.id !== "home")
                .map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => workspace.select(tab.id)}
                    className="flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-sm hover:bg-muted"
                  >
                    <span className="truncate">
                      {workspace.title(tab.root)}
                    </span>
                    <ArrowRight className="h-3.5 w-3.5 shrink-0" />
                  </button>
                ))}
              {workspace.state.tabs.length === 1 ? (
                <p className="text-sm text-muted-foreground">
                  Open a module from the menu to start working.
                </p>
              ) : null}
            </div>
          </section>
          <section className="rounded-xl border border-dashed bg-primary/5 p-4 text-sm text-muted-foreground">
            Your Home tab stays open. Use the menu to open modules, drag their
            tabs to reorder them, or use the tab menu to close workspaces.
          </section>
        </div>
      </div>
    </div>
  );
}
