/* Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu. */
import { useMemo } from 'react';
import { ArrowRight, CalendarDays, LayoutGrid, RotateCcw, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DashboardCustomizer, DashboardGridEngine } from '@/components/dashboard/engine';
import { DASHBOARD_WIDGETS } from '@/components/dashboard/registry';
import { useDashboardLayout } from '@/hooks/use-dashboard-layout';
import { useDashboardAccess } from '@/hooks/use-dashboard-access';
import { useTenantTheme } from '@/hooks/use-tenant-theme';
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
  const { tenantContext, isLoading } = useTenantTheme({ applyTheme: false });
  const { hasPermission, hasWorkspacePermission, canViewSensitive } = useDashboardAccess();
  const canViewDashboard = hasPermission('view_dashboard');
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
  const dashboard = useDashboardLayout(widgets, storageScope);
  const today = new Intl.DateTimeFormat(tenantContext.branding.locale || 'en-KE', {
    weekday: 'long', day: '2-digit', month: 'short', year: 'numeric', timeZone: tenantContext.branding.timezone,
  }).format(new Date());

  if (isLoading) return <div className="p-12 text-center font-mono text-sm text-muted-foreground animate-pulse">Loading workspace dashboard...</div>;

  if (!canViewDashboard) {
    const workspaceItems = tenantContext.sections
      .flatMap((section) => section.items.map((item) => ({ ...item, section: section.title })))
      .filter((item) => item.path && item.path !== '/dashboard')
      .filter((item, index, items) => items.findIndex((candidate) => candidate.path === item.path) === index);

    return <div className="mx-auto max-w-5xl space-y-6 py-4">
      <header className="border-b border-border/80 pb-5">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-primary/10 p-3"><LayoutGrid className="h-6 w-6 text-primary" /></div>
          <div>
            <h1 className="text-2xl font-bold">{tenantContext.tenantName}</h1>
            <p className="mt-1 text-sm text-muted-foreground">Choose an area available to your current role.</p>
          </div>
        </div>
      </header>
      {workspaceItems.length ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {workspaceItems.map((item) => <button
          key={item.path}
          type="button"
          onClick={() => setLocation(item.path)}
          className="group flex min-h-28 flex-col rounded-xl border bg-card p-4 text-left shadow-sm transition-colors hover:border-primary/40 hover:bg-accent/40"
        >
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{item.section}</span>
          <span className="mt-2 flex items-center justify-between gap-3 font-semibold">{item.title}<ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary" /></span>
        </button>)}
      </div> : <div className="rounded-xl border border-dashed p-10 text-center">
        <h2 className="font-semibold">No workspace areas are assigned yet</h2>
        <p className="mt-2 text-sm text-muted-foreground">Ask an administrator to assign module access and menu permissions to your role.</p>
      </div>}
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
        <Button variant="ghost" size="icon" title="Reset dashboard" onClick={dashboard.resetLayout}><RotateCcw className="h-4 w-4" /></Button>
      </div>
    </header>

    {dashboard.customizeMode ? (
      <DashboardCustomizer widgets={widgets} layout={dashboard.layout} customizeMode={dashboard.customizeMode} setCustomizeMode={dashboard.setCustomizeMode} updateItem={dashboard.updateItem} resetLayout={dashboard.resetLayout} />
    ) : widgets.length ? (
      <DashboardGridEngine widgets={widgets} layout={dashboard.layout} tenantContext={tenantContext} canViewSensitive={canViewSensitive} customizeMode={false} updateItem={dashboard.updateItem} moveItem={dashboard.moveItem} swapItems={dashboard.swapItems} cycleWidgetWidth={dashboard.cycleWidgetWidth} />
    ) : <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">No dashboard panels are available for this role. Ask an administrator to assign module overview permissions.</div>}
  </div>;
}
