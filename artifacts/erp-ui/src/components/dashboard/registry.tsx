import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
import {
  ArrowRight,
  Building2,
  ClipboardList,
  EyeOff,
  Gauge,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type {
  DashboardTenantContextValue,
  DashboardWidgetComponentProps,
  DashboardWidgetDefinition,
} from '@/components/dashboard/types';

function buildHeaders(token: string | null): Record<string, string> {
  return token ? { Authorization: `Token ${token}` } : {};
}

function useDashboardToken() {
  try {
    return localStorage.getItem('sl-erp-token');
  } catch {
    return null;
  }
}

function formatMoney(value: number, ctx: DashboardTenantContextValue, masked: boolean) {
  if (masked) return '••••••';
  return `${ctx.branding.currency} ${value.toLocaleString(ctx.branding.locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(value: string | null | undefined, ctx: DashboardTenantContextValue) {
  if (!value) return '—';
  return new Intl.DateTimeFormat(ctx.branding.locale, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: ctx.branding.timezone,
    hour12: false,
  }).format(new Date(value));
}

function MetricTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: 'default' | 'positive' | 'warning';
}) {
  return (
    <div className={cn(
      'rounded-2xl border p-4',
      tone === 'positive' && 'border-emerald-200 bg-emerald-50/70',
      tone === 'warning' && 'border-amber-200 bg-amber-50/70',
    )}>
      <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className="mt-2 text-2xl font-black tracking-tight">{value}</div>
    </div>
  );
}

function HeroWidget({ tenantContext }: DashboardWidgetComponentProps) {
  const today = new Intl.DateTimeFormat(tenantContext.branding.locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: tenantContext.branding.timezone,
  }).format(new Date());

  return (
    <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge className="border-transparent bg-primary/10 text-primary hover:bg-primary/10">ERP Control Tower</Badge>
          <Badge variant="outline">{tenantContext.role.replace('_', ' ')}</Badge>
          <Badge variant="outline">{today}</Badge>
        </div>
        <div className="space-y-2">
          <h1 className="text-3xl font-black tracking-tight">
            Today
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            {today}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/platform/organization-settings">
            <Button size="sm" className="gap-2">
              Settings
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
          <Link href="/platform/roles">
            <Button size="sm" variant="outline" className="gap-2">
              Roles
            </Button>
          </Link>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
        <MetricTile label="Code" value={tenantContext.tenantCode || 'live'} />
        <MetricTile label="Modules" value={tenantContext.activeModuleSlugs.length || tenantContext.sections.length} tone="positive" />
        <MetricTile label="Currency" value={tenantContext.branding.currency} />
      </div>
    </div>
  );
}

function CompanyHealthWidget({ tenantContext, canViewSensitive }: DashboardWidgetComponentProps) {
  const token = useDashboardToken();
  const accountingQuery = useQuery({
    queryKey: ['dashboard-widget-accounting', tenantContext.tenantId],
    enabled: !!token && !!tenantContext.tenantId,
    staleTime: 60000,
    queryFn: async () => {
      const res = await fetch('/api/accounting/dashboard/', { headers: buildHeaders(token) });
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
  });
  const procurementQuery = useQuery({
    queryKey: ['dashboard-widget-procurement', tenantContext.tenantId],
    enabled: !!token && !!tenantContext.tenantId,
    staleTime: 60000,
    queryFn: async () => {
      const res = await fetch('/api/procurement/dashboard/', { headers: buildHeaders(token) });
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
  });

  const finance = accountingQuery.data?.journals ?? {};
  const supply = procurementQuery.data ?? {};
  const cashFlow = Number(finance.cash_in || 0) - Number(finance.cash_out || 0);
  const procurementThroughput = Number(supply.counts?.received || 0) + Number(supply.counts?.approved || 0);
  const requisitionTotal = Number(supply.requisitions?.total || 0);
  const inventoryTurnRateProxy = requisitionTotal > 0 ? ((procurementThroughput / requisitionTotal) * 100).toFixed(1) : '0.0';

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        <MetricTile
          label="Cash Flow"
          value={formatMoney(cashFlow, tenantContext, !canViewSensitive)}
          tone={cashFlow >= 0 ? 'positive' : 'warning'}
        />
        <MetricTile
          label="Inventory Turn Rate"
          value={`${inventoryTurnRateProxy}%`}
          tone="positive"
        />
        <MetricTile
          label="Outstanding"
          value={formatMoney(Number(accountingQuery.data?.invoices?.outstanding || 0), tenantContext, !canViewSensitive)}
          tone="warning"
        />
      </div>
      <div className="rounded-2xl border border-border/70 bg-muted/20 p-4 text-sm text-muted-foreground">
        Inventory turn rate is currently a procurement throughput proxy until stock-ledger and warehouse movement APIs are available.
      </div>
    </div>
  );
}

function ActionableInsightsWidget({ tenantContext, canViewSensitive }: DashboardWidgetComponentProps) {
  const token = useDashboardToken();
  const [wb, accounting, procurement] = [
    useQuery({
      queryKey: ['dashboard-widget-wb-insights', tenantContext.tenantId],
      enabled: !!token && !!tenantContext.tenantId,
      staleTime: 60000,
      queryFn: async () => {
        const res = await fetch('/api/commercial-weighbridge/dashboard/', { headers: buildHeaders(token) });
        if (!res.ok) throw new Error(`${res.status}`);
        return res.json();
      },
    }),
    useQuery({
      queryKey: ['dashboard-widget-acct-insights', tenantContext.tenantId],
      enabled: !!token && !!tenantContext.tenantId,
      staleTime: 60000,
      queryFn: async () => {
        const res = await fetch('/api/accounting/dashboard/', { headers: buildHeaders(token) });
        if (!res.ok) throw new Error(`${res.status}`);
        return res.json();
      },
    }),
    useQuery({
      queryKey: ['dashboard-widget-proc-insights', tenantContext.tenantId],
      enabled: !!token && !!tenantContext.tenantId,
      staleTime: 60000,
      queryFn: async () => {
        const res = await fetch('/api/procurement/dashboard/', { headers: buildHeaders(token) });
        if (!res.ok) throw new Error(`${res.status}`);
        return res.json();
      },
    }),
  ];

  const alerts = useMemo(() => {
    const items = [];
    const pendingPayments = Number(wb.data?.totals?.pending_payments || 0);
    const submittedPos = Number(procurement.data?.counts?.submitted || 0);
    const blockedReqs = Number(procurement.data?.requisitions?.blocked || 0);
    const outstanding = Number(accounting.data?.invoices?.outstanding || 0);

    if (blockedReqs > 0) {
      items.push({
        title: `${blockedReqs} requisition${blockedReqs === 1 ? '' : 's'} blocked by budget control`,
        detail: 'Budget exceptions are already slowing downstream purchasing.',
        href: '/procurement/requisitions',
        tone: 'critical',
      });
    }
    if (submittedPos > 0) {
      items.push({
        title: `${submittedPos} purchase order${submittedPos === 1 ? '' : 's'} awaiting action`,
        detail: 'Review supplier commitments before they start affecting fulfilment timing.',
        href: '/procurement/purchase-orders',
        tone: 'warning',
      });
    }
    if (pendingPayments > 0) {
      items.push({
        title: `${pendingPayments} weighbridge payment${pendingPayments === 1 ? '' : 's'} pending`,
        detail: 'Pending bridge settlements can delay invoicing and downstream posting.',
        href: '/weighbridge/transactions',
        tone: 'warning',
      });
    }
    if (outstanding > 0) {
      items.push({
        title: 'Receivables need collection follow-up',
        detail: `${formatMoney(outstanding, tenantContext, !canViewSensitive)} remains outstanding.`,
        href: '/accounting/dashboard',
        tone: 'info',
      });
    }

    if (!items.length) {
      items.push({
        title: 'No critical ERP alerts right now',
        detail: 'The monitored modules are currently within expected thresholds.',
        href: '/dashboard',
        tone: 'info',
      });
    }
    return items.slice(0, 5);
  }, [accounting.data, canViewSensitive, procurement.data, tenantContext, wb.data]);

  return (
    <div className="space-y-3">
      {alerts.map((item) => (
        <Link key={item.title} href={item.href} className="block rounded-2xl border border-border/70 p-4 transition-colors hover:bg-muted/30">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-semibold">{item.title}</div>
              <p className="mt-1 text-sm text-muted-foreground">{item.detail}</p>
            </div>
            <Badge className={cn(
              item.tone === 'critical' && 'bg-red-100 text-red-800 hover:bg-red-100',
              item.tone === 'warning' && 'bg-amber-100 text-amber-800 hover:bg-amber-100',
              item.tone === 'info' && 'bg-sky-100 text-sky-800 hover:bg-sky-100',
            )}>
              {item.tone}
            </Badge>
          </div>
        </Link>
      ))}
    </div>
  );
}

function WorkflowNotificationsWidget({ tenantContext, canViewSensitive }: DashboardWidgetComponentProps) {
  return <ActionableInsightsWidget tenantContext={tenantContext} canViewSensitive={canViewSensitive} customizeMode={false} />;
}

function AuditTrailWidget({ tenantContext }: DashboardWidgetComponentProps) {
  const token = useDashboardToken();
  const auditQuery = useQuery({
    queryKey: ['dashboard-widget-audit', tenantContext.tenantId],
    enabled: !!token && !!tenantContext.tenantId,
    staleTime: 60000,
    queryFn: async () => {
      const res = await fetch('/api/platform/audit/events/?limit=6', { headers: buildHeaders(token) });
      if (!res.ok) throw new Error(`${res.status}`);
      const json = await res.json();
      return json?.data ?? json;
    },
  });

  const rows = Array.isArray(auditQuery.data) ? auditQuery.data : [];

  return (
    <div className="space-y-3">
      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-5 text-sm text-muted-foreground">
          No recent audit events are visible for your department scope.
        </div>
      ) : rows.map((row: any) => (
        <div key={row.id} className="rounded-2xl border border-border/70 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-semibold">{row.object_repr || row.model_label || row.event_type}</div>
              <p className="mt-1 text-sm text-muted-foreground">
                {row.note || `${row.event_group} · ${row.event_type}`}
              </p>
            </div>
            <Badge variant="outline">{row.status || 'logged'}</Badge>
          </div>
          <div className="mt-3 text-xs text-muted-foreground">
            {row.actor_name || 'System'} · {formatDate(row.created_at, tenantContext)}
          </div>
        </div>
      ))}
    </div>
  );
}

function WorkflowInboxWidget({ tenantContext }: DashboardWidgetComponentProps) {
  const token = useDashboardToken();
  const inboxQuery = useQuery({
    queryKey: ['dashboard-widget-inbox', tenantContext.tenantId],
    enabled: !!token && !!tenantContext.tenantId,
    staleTime: 30000,
    queryFn: async () => {
      const res = await fetch('/api/platform/workflows/inbox/', { headers: buildHeaders(token) });
      if (!res.ok) throw new Error(`${res.status}`);
      const json = await res.json();
      return json?.data ?? json;
    },
  });

  const items = inboxQuery.data?.results ?? [];

  return (
    <div className="space-y-3">
      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-5 text-sm text-muted-foreground">
          No workflow approvals are waiting for you.
        </div>
      ) : items.slice(0, 5).map((item: any) => (
        <div key={item.id} className="rounded-2xl border border-border/70 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-semibold">{item.title}</div>
              <p className="mt-1 text-sm text-muted-foreground">{item.detail}</p>
            </div>
            <Badge variant="secondary">{item.reference || 'Workflow'}</Badge>
          </div>
          <div className="mt-3">
            <Link href={item.route_path || '/dashboard'} className="text-sm font-medium text-primary hover:underline">
              Open request
            </Link>
          </div>
        </div>
      ))}
    </div>
  );
}

function ModuleMapWidget({ tenantContext }: DashboardWidgetComponentProps) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {tenantContext.sections.map((section) => (
        <Link key={section.key} href={section.items[0]?.path || '/dashboard'}>
          <div className="rounded-2xl border border-border/70 bg-muted/15 p-4 transition-colors hover:bg-muted/30">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="font-semibold">{section.title}</div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {section.items.length} linked workspace item{section.items.length === 1 ? '' : 's'}
                </p>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

function FinancePulseWidget({ tenantContext, canViewSensitive }: DashboardWidgetComponentProps) {
  const token = useDashboardToken();
  const query = useQuery({
    queryKey: ['dashboard-widget-finance-pulse', tenantContext.tenantId],
    enabled: !!token && !!tenantContext.tenantId,
    staleTime: 60000,
    queryFn: async () => {
      const res = await fetch('/api/accounting/dashboard/', { headers: buildHeaders(token) });
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
  });

  const data = query.data ?? {};
  const invoices = data.invoices ?? {};
  const journals = data.journals ?? {};

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <MetricTile label="Total Invoiced" value={formatMoney(Number(invoices.total_invoiced || 0), tenantContext, !canViewSensitive)} />
      <MetricTile label="Collected" value={formatMoney(Number(invoices.total_paid || 0), tenantContext, !canViewSensitive)} tone="positive" />
      <MetricTile label="Cash In" value={formatMoney(Number(journals.cash_in || 0), tenantContext, !canViewSensitive)} tone="positive" />
      <MetricTile label="Cash Out" value={formatMoney(Number(journals.cash_out || 0), tenantContext, !canViewSensitive)} tone="warning" />
    </div>
  );
}

function OperationsPulseWidget({ tenantContext }: DashboardWidgetComponentProps) {
  const token = useDashboardToken();
  const weighbridgeQuery = useQuery({
    queryKey: ['dashboard-widget-ops-weight', tenantContext.tenantId],
    enabled: !!token && !!tenantContext.tenantId,
    staleTime: 60000,
    queryFn: async () => {
      const res = await fetch('/api/commercial-weighbridge/dashboard/', { headers: buildHeaders(token) });
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
  });
  const procurementQuery = useQuery({
    queryKey: ['dashboard-widget-ops-procurement', tenantContext.tenantId],
    enabled: !!token && !!tenantContext.tenantId,
    staleTime: 60000,
    queryFn: async () => {
      const res = await fetch('/api/procurement/dashboard/', { headers: buildHeaders(token) });
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
  });

  const wb = weighbridgeQuery.data ?? {};
  const procurement = procurementQuery.data ?? {};

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <MetricTile label="Bridge Today" value={Number(wb.totals?.transactions_today || 0)} />
      <MetricTile label="Net Weight Today" value={`${Number(wb.totals?.net_weight_today || 0).toLocaleString()} kg`} />
      <MetricTile label="PO Approved" value={Number(procurement.counts?.approved || 0)} tone="positive" />
      <MetricTile label="Req Blocked" value={Number(procurement.requisitions?.blocked || 0)} tone="warning" />
    </div>
  );
}

function ShortcutStackWidget({ tenantContext, canViewSensitive }: DashboardWidgetComponentProps) {
  const shortcuts = tenantContext.sections
    .flatMap((section) => section.items)
    .filter((item, index, items) => item.path !== '/dashboard' && items.findIndex((entry) => entry.path === item.path) === index)
    .slice(0, 8)
    .map((item) => {
      if (item.path.includes('/accounting/')) {
        return { title: item.title, href: item.path, icon: Wallet, masked: !canViewSensitive };
      }
      if (item.path.includes('/platform/company-settings') || item.path.includes('/platform/organization-settings')) {
        return { title: item.title, href: item.path, icon: Building2, masked: false };
      }
      if (item.path.includes('/platform/audit')) {
        return { title: item.title, href: item.path, icon: ShieldCheck, masked: false };
      }
      if (item.path.includes('/weighbridge/weighment-entry') || item.path.includes('/weighbridge/weight-capture')) {
        return { title: item.title, href: item.path, icon: Gauge, masked: false };
      }
      return { title: item.title, href: item.path, icon: ClipboardList, masked: false };
    });

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {shortcuts.map((item) => {
        const Icon = item.icon;
        return (
          <Link key={item.title} href={item.href}>
            <div className="flex items-center gap-3 rounded-2xl border border-border/70 p-4 transition-colors hover:bg-muted/20">
              <div className="rounded-xl bg-primary/10 p-2 text-primary">
                <Icon className="h-4 w-4" />
              </div>
              <div className="flex-1">
                <div className="font-semibold">{item.title}</div>
                <div className="text-sm text-muted-foreground">
                  {item.masked ? (
                    <span className="inline-flex items-center gap-1"><EyeOff className="h-3.5 w-3.5" /> Sensitive for current role</span>
                  ) : 'Open workspace'}
                </div>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
            </div>
          </Link>
        );
      })}
    </div>
  );
}

export const DASHBOARD_WIDGETS: DashboardWidgetDefinition[] = [
  {
    id: 'hero',
    title: 'Tenant Command Header',
    description: 'Brand-aware ERP identity, tenant scope, and top-level workspace orientation.',
    category: 'overview',
    requiredPermissions: ['view_dashboard'],
    defaultLayout: { widgetId: 'hero', x: 0, y: 0, w: 12, h: 3, isCollapsed: false, isEnabled: true },
    component: HeroWidget,
  },
  {
    id: 'company-health',
    title: 'Company Health',
    description: 'Unified finance and supply-chain pulse with tenant-safe analytics.',
    category: 'analytics',
    requiredPermissions: ['view_company_health', 'view_financials', 'view_supply_chain'],
    moduleDependencies: ['accounting', 'procurement'],
    defaultLayout: { widgetId: 'company-health', x: 0, y: 3, w: 7, h: 4, isCollapsed: false, isEnabled: true },
    component: CompanyHealthWidget,
  },
  {
    id: 'actionable-insights',
    title: 'Workflow Notifications',
    description: 'Operational alerts and workflow-driven issues that need follow-up.',
    category: 'operations',
    requiredPermissions: ['view_operational_alerts'],
    defaultLayout: { widgetId: 'actionable-insights', x: 7, y: 3, w: 5, h: 4, isCollapsed: false, isEnabled: true },
    component: WorkflowNotificationsWidget,
  },
  {
    id: 'workflow-inbox',
    title: 'Pending Approvals',
    description: 'Approval requests assigned to the current user and available for follow-up.',
    category: 'workflows',
    requiredPermissions: ['view_workflow_inbox'],
    defaultLayout: { widgetId: 'workflow-inbox', x: 0, y: 7, w: 4, h: 5, isCollapsed: false, isEnabled: true },
    component: WorkflowInboxWidget,
  },
  {
    id: 'module-map',
    title: 'Workspace Modules',
    description: 'Config-driven module cards aligned to the active tenant subscription and navigation.',
    category: 'overview',
    requiredPermissions: ['view_shortcuts'],
    defaultLayout: { widgetId: 'module-map', x: 4, y: 7, w: 4, h: 5, isCollapsed: false, isEnabled: true },
    component: ModuleMapWidget,
  },
  {
    id: 'audit-trail',
    title: 'Audit & Compliance Trail',
    description: 'Recent department-scoped state changes, approvals, and critical system mutations.',
    category: 'compliance',
    requiredPermissions: ['view_audit_trail'],
    defaultLayout: { widgetId: 'audit-trail', x: 8, y: 7, w: 4, h: 5, isCollapsed: false, isEnabled: true },
    component: AuditTrailWidget,
  },
  {
    id: 'finance-pulse',
    title: 'Finance Pulse',
    description: 'Collections, outstanding exposure, and posting readiness with masking support.',
    category: 'analytics',
    requiredPermissions: ['view_financials'],
    moduleDependencies: ['accounting'],
    defaultLayout: { widgetId: 'finance-pulse', x: 0, y: 12, w: 6, h: 4, isCollapsed: false, isEnabled: true },
    component: FinancePulseWidget,
  },
  {
    id: 'operations-pulse',
    title: 'Operations Pulse',
    description: 'Daily throughput, queue pressure, and procurement execution status.',
    category: 'operations',
    requiredPermissions: ['view_dashboard'],
    defaultLayout: { widgetId: 'operations-pulse', x: 6, y: 12, w: 6, h: 4, isCollapsed: false, isEnabled: true },
    component: OperationsPulseWidget,
  },
  {
    id: 'shortcut-stack',
    title: 'Shortcut Stack',
    description: 'Quick links generated from the tenant subscription and the logged-in user workspace access.',
    category: 'overview',
    requiredPermissions: ['view_shortcuts'],
    defaultLayout: { widgetId: 'shortcut-stack', x: 0, y: 16, w: 12, h: 3, isCollapsed: false, isEnabled: true },
    component: ShortcutStackWidget,
  },
];
