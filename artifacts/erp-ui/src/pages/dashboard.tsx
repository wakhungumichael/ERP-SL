/* Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu. */
import { useCallback, useMemo, useState } from 'react';
import { Bell, CalendarDays, CheckSquare2, ChevronDown, LayoutGrid, RotateCcw, Settings2 } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { DashboardCustomizer, DashboardGridEngine } from '@/components/dashboard/engine';
import { DASHBOARD_WIDGETS } from '@/components/dashboard/registry';
import { useDashboardLayout } from '@/hooks/use-dashboard-layout';
import { useDashboardAccess } from '@/hooks/use-dashboard-access';
import { useTenantTheme } from '@/hooks/use-tenant-theme';
import { useAuth } from '@/context/use-auth';
import { useToast } from '@/hooks/use-toast';
import { useLocation } from 'wouter';

function greeting(timezone: string) {
  const hour = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: timezone }).format(new Date()));
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

const MODULE_ALIASES: Record<string, string[]> = {
  accounting: ['accounting', 'finance'],
  'hr-payroll': ['hr-payroll', 'hr', 'hcm'],
  weighbridge: ['weighbridge', 'commercial-weighbridge'],
};

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const { token, user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { tenantContext, isLoading } = useTenantTheme({ applyTheme: false });
  const { hasPermission, hasWorkspacePermission, canViewSensitive } = useDashboardAccess();
  const canViewDashboard = hasPermission('view_dashboard');
  const [notificationsOpen, setNotificationsOpen] = useState(true);
  const [tasksOpen, setTasksOpen] = useState(true);
  const visibleModuleKeys = useMemo(() => new Set([
    ...tenantContext.activeModuleSlugs,
    ...tenantContext.sections.map((section) => section.key),
  ].map((value) => String(value).toLowerCase())), [tenantContext.activeModuleSlugs, tenantContext.sections]);

  const widgets = useMemo(() => DASHBOARD_WIDGETS.filter((widget) => {
    const hasRoleAccess = widget.requiredPermissions.every(hasPermission);
    const hasModules = !widget.moduleDependencies?.length || widget.moduleDependencies.every((module) =>
      (MODULE_ALIASES[module] ?? [module]).some((alias) => visibleModuleKeys.has(alias)),
    );
    const hasOverviewAccess = !widget.workspacePermissions?.length || widget.workspacePermissions.every(hasWorkspacePermission);
    return hasRoleAccess && hasModules && hasOverviewAccess;
  }), [hasPermission, hasWorkspacePermission, visibleModuleKeys]);

  const storageScope = `${tenantContext.tenantId ?? 'global'}:${tenantContext.userId ?? 'anonymous'}:${tenantContext.role}`;
  const dashboardLayoutQuery = useQuery({
    queryKey: ['workspace-dashboard-layout', tenantContext.tenantId, tenantContext.role, token],
    enabled: !!token && !!tenantContext.tenantId && canViewDashboard,
    retry: false,
    queryFn: async () => {
      const response = await fetch('/api/platform/workspace/dashboard-layout/', { headers: { Authorization: `Token ${token}` } });
      if (!response.ok) throw new Error('Could not load your saved dashboard.');
      const body = await response.json();
      return body?.data ?? body;
    },
  });
  const saveLayout = useMutation({
    mutationFn: async ({ layout, scope = 'personal', reset = false }: { layout?: any[]; scope?: 'personal' | 'role'; reset?: boolean }) => {
      const response = await fetch('/api/platform/workspace/dashboard-layout/', {
        method: 'POST', headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ layout, scope, reset }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.message || 'Dashboard could not be saved.');
      return body?.data ?? body;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workspace-dashboard-layout'] }),
  });
  const persistPersonalLayout = useCallback((layout: any[]) => {
    saveLayout.mutate({ layout });
  }, [saveLayout.mutate]);
  const dashboard = useDashboardLayout(
    widgets,
    storageScope,
    dashboardLayoutQuery.data?.layout ?? null,
    Boolean(dashboardLayoutQuery.isSuccess),
    persistPersonalLayout,
  );
  const canManageRoleDashboard = Boolean(dashboardLayoutQuery.data?.can_manage_role_layout || (user as any)?.is_superuser);
  const today = new Intl.DateTimeFormat(tenantContext.branding.locale || 'en-KE', {
    weekday: 'long', day: '2-digit', month: 'short', year: 'numeric', timeZone: tenantContext.branding.timezone,
  }).format(new Date());
  const personalNotifications = useQuery({
    queryKey: ['personal-dashboard-notifications', token],
    enabled: !!token && !isLoading && !canViewDashboard,
    queryFn: async () => {
      const response = await fetch('/api/platform/notifications/?unread=1&page=1&page_size=8', {
        headers: { Authorization: `Token ${token}` },
      });
      if (!response.ok) return [];
      const body = await response.json();
      const data = body?.data ?? body;
      return Array.isArray(data?.results) ? data.results : [];
    },
  });
  const personalTasks = useQuery({
    queryKey: ['personal-dashboard-tasks', token, tenantContext.tenantId],
    enabled: !!token && !isLoading && !canViewDashboard,
    queryFn: async () => {
      const response = await fetch('/api/projects/tasks/?scope=mine&page=1&page_size=8&ordering=due_date', {
        headers: { Authorization: `Token ${token}` },
      });
      if (!response.ok) return [];
      const body = await response.json();
      const data = body?.data ?? body;
      return Array.isArray(data?.results) ? data.results : [];
    },
  });

  if (isLoading) return <div className="p-12 text-center font-mono text-sm text-muted-foreground animate-pulse">Loading workspace dashboard...</div>;

  if (!canViewDashboard) {
    const notifications = personalNotifications.data ?? [];
    const tasks = personalTasks.data ?? [];
    return <div className="mx-auto max-w-4xl space-y-6 py-4">
      <header className="border-b border-border/80 pb-5">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-primary/10 p-3"><LayoutGrid className="h-6 w-6 text-primary" /></div>
          <div>
            <h1 className="text-2xl font-bold">{tenantContext.tenantName}</h1>
            <p className="mt-1 text-sm text-muted-foreground">Your assigned work and notifications.</p>
          </div>
        </div>
      </header>
      <div className="space-y-3">
        <Collapsible open={notificationsOpen} onOpenChange={setNotificationsOpen} className="rounded-xl border bg-card shadow-sm">
          <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 p-4 text-left">
            <span className="flex items-center gap-3 font-semibold"><Bell className="h-4 w-4 text-primary" />Workflow notifications <Badge variant="secondary">{notifications.length}</Badge></span>
            <ChevronDown className={`h-4 w-4 transition-transform ${notificationsOpen ? 'rotate-180' : ''}`} />
          </CollapsibleTrigger>
          <CollapsibleContent className="border-t">
            {notifications.length ? <div className="divide-y">{notifications.map((notice: any) => <button key={notice.id} type="button" onClick={() => notice.route_path && setLocation(notice.route_path)} className="block w-full p-4 text-left hover:bg-accent/50 disabled:cursor-default" disabled={!notice.route_path}>
              <p className="font-medium">{notice.title || 'System notification'}</p><p className="mt-1 text-sm text-muted-foreground">{notice.message || notice.body || 'A workflow item needs your attention.'}</p>
            </button>)}</div> : <p className="p-5 text-sm text-muted-foreground">No unread workflow notifications.</p>}
          </CollapsibleContent>
        </Collapsible>
        <Collapsible open={tasksOpen} onOpenChange={setTasksOpen} className="rounded-xl border bg-card shadow-sm">
          <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 p-4 text-left">
            <span className="flex items-center gap-3 font-semibold"><CheckSquare2 className="h-4 w-4 text-primary" />My tasks <Badge variant="secondary">{tasks.length}</Badge></span>
            <ChevronDown className={`h-4 w-4 transition-transform ${tasksOpen ? 'rotate-180' : ''}`} />
          </CollapsibleTrigger>
          <CollapsibleContent className="border-t">
            {tasks.length ? <div className="divide-y">{tasks.map((task: any) => <button key={task.id} type="button" onClick={() => setLocation(`/projects/tasks/${task.id}`)} className="block w-full p-4 text-left hover:bg-accent/50">
              <p className="font-medium">{task.number ? `${task.number} · ` : ''}{task.title}</p><p className="mt-1 text-sm text-muted-foreground">{task.status?.replaceAll('_', ' ') || 'Open'}{task.due_date ? ` · Due ${task.due_date}` : ''}</p>
            </button>)}</div> : <p className="p-5 text-sm text-muted-foreground">No tasks are assigned to you.</p>}
          </CollapsibleContent>
        </Collapsible>
      </div>
    </div>;
  }

  return <div className="space-y-5">
    <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border/80 pb-5">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge className="bg-primary/10 text-primary hover:bg-primary/10">Business performance</Badge>
        </div>
        <h1 className="mt-3 text-2xl font-black tracking-tight">{greeting(tenantContext.branding.timezone)}, {tenantContext.displayName || tenantContext.tenantName}</h1>
        <p className="mt-1 text-sm text-muted-foreground">Live operational, collection, and workflow signals for your current role.</p>
      </div>
      <div className="flex items-center gap-3">
        <div className="hidden items-center gap-2 rounded-lg border bg-card px-3 py-2 text-xs text-muted-foreground shadow-sm sm:inline-flex"><CalendarDays className="h-3.5 w-3.5 text-primary" />{today}</div>
        <Button variant={dashboard.customizeMode ? 'default' : 'outline'} size="sm" className="gap-2" onClick={() => dashboard.setCustomizeMode(!dashboard.customizeMode)}><Settings2 className="h-4 w-4" />{dashboard.customizeMode ? 'Done' : 'Configure'}</Button>
        {dashboard.customizeMode && canManageRoleDashboard ? <Button variant="outline" size="sm" disabled={saveLayout.isPending} onClick={() => saveLayout.mutate({ layout: dashboard.serializedPayload, scope: 'role' }, { onSuccess: () => toast({ title: `Standard ${dashboardLayoutQuery.data?.role_name || 'role'} dashboard saved`, description: 'Members of this role will use this arrangement unless they personalize it.' }), onError: (error) => toast({ title: 'Could not save role dashboard', description: error.message, variant: 'destructive' }) })}>Save as role standard</Button> : null}
        <Button variant="ghost" size="icon" title="Use the role dashboard" onClick={() => saveLayout.mutate({ scope: 'personal', reset: true }, { onSuccess: () => toast({ title: 'Personal layout cleared', description: 'You are now using the standard dashboard for this role.' }), onError: (error) => toast({ title: 'Could not reset dashboard', description: error.message, variant: 'destructive' }) })}><RotateCcw className="h-4 w-4" /></Button>
      </div>
    </header>

    {dashboard.customizeMode ? (
      <DashboardCustomizer widgets={widgets} layout={dashboard.layout} customizeMode={dashboard.customizeMode} setCustomizeMode={dashboard.setCustomizeMode} updateItem={dashboard.updateItem} resetLayout={dashboard.resetLayout} />
    ) : widgets.length ? (
      <DashboardGridEngine widgets={widgets} layout={dashboard.layout} tenantContext={tenantContext} canViewSensitive={canViewSensitive} customizeMode={false} updateItem={dashboard.updateItem} moveItem={dashboard.moveItem} swapItems={dashboard.swapItems} cycleWidgetWidth={dashboard.cycleWidgetWidth} />
    ) : <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">No dashboard panels are available for this role. Ask an administrator to assign module overview permissions.</div>}
  </div>;
}
