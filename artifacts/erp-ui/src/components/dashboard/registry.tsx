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
    <div className="flex flex-wrap items-end justify-between gap-5">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge className="border-transparent bg-primary/10 text-primary hover:bg-primary/10">Live business overview</Badge>
          <Badge variant="outline">{tenantContext.role.replace('_', ' ')}</Badge>
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-black tracking-tight">{tenantContext.tenantName || 'Business workspace'}</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">Monitor operational throughput, payment exposure, and work needing attention. Data is limited to your role and assigned branches.</p>
        </div>
      </div>
      <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-right">
        <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Reporting date</div>
        <div className="mt-1 text-sm font-bold">{today}</div>
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

function OperationsPulseWidget({ tenantContext, canViewSensitive }: DashboardWidgetComponentProps) {
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
  const wb = weighbridgeQuery.data ?? {};
  const totals = wb.totals ?? {};
  const activity = Array.isArray(wb.daily_activity) ? wb.daily_activity : [];
  const maxTransactions = Math.max(...activity.map((entry: { transactions?: number }) => Number(entry.transactions || 0)), 1);

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricTile label="Weighments today" value={Number(totals.transactions_today || 0)} />
        <MetricTile label="Net weight today" value={`${Number(totals.net_weight_today || 0).toLocaleString()} kg`} tone="positive" />
        <MetricTile label="Completed charges this month" value={formatMoney(Number(totals.total_charge || 0), tenantContext, !canViewSensitive)} tone="positive" />
        <MetricTile label="Pending payment tickets" value={Number(totals.pending_payments || 0)} tone="warning" />
      </div>
      <div>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-bold">Seven-day weighment trend</div>
            <p className="text-xs text-muted-foreground">Recorded transactions per day across your permitted branches.</p>
          </div>
          <Link href="/weighbridge/transactions"><Button variant="outline" size="sm">View transactions <ArrowRight className="ml-1 h-3.5 w-3.5" /></Button></Link>
        </div>
        <div className="grid h-28 grid-cols-7 items-end gap-2 rounded-xl border bg-muted/20 px-3 pb-2 pt-3">
          {activity.map((entry: { date: string; transactions: number }) => {
            const label = new Intl.DateTimeFormat(tenantContext.branding.locale, { weekday: 'short', timeZone: tenantContext.branding.timezone }).format(new Date(`${entry.date}T12:00:00`));
            const transactions = Number(entry.transactions || 0);
            return <div key={entry.date} className="flex h-full min-w-0 flex-col justify-end gap-1 text-center">
              <div className="text-[10px] font-bold text-muted-foreground">{transactions}</div>
              <div className="min-h-1 rounded-t bg-primary/80" style={{ height: `${Math.max(5, (transactions / maxTransactions) * 72)}%` }} title={`${transactions} transactions`} />
              <div className="text-[10px] text-muted-foreground">{label}</div>
            </div>;
          })}
          {!activity.length ? <div className="col-span-7 self-center text-center text-sm text-muted-foreground">No weighment activity recorded in the last seven days.</div> : null}
        </div>
      </div>
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

function InventoryPulseWidget({ tenantContext, canViewSensitive }: DashboardWidgetComponentProps) {
  const token = useDashboardToken();
  const query = useQuery({
    queryKey: ['dashboard-widget-inventory', tenantContext.tenantId],
    enabled: !!token && !!tenantContext.tenantId,
    staleTime: 60000,
    queryFn: async () => {
      const res = await fetch('/api/inventory/dashboard/', { headers: buildHeaders(token) });
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
  });
  const data = query.data ?? {};
  return <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
    <MetricTile label="Available stock" value={Number(data.totals?.available || 0).toLocaleString()} tone="positive" />
    <MetricTile label="Reserved stock" value={Number(data.totals?.reserved || 0).toLocaleString()} tone="warning" />
    <MetricTile label="Warehouses" value={Number(data.counts?.warehouses || 0)} />
    <MetricTile label="Stock value" value={formatMoney(Number(data.totals?.valuation || 0), tenantContext, !canViewSensitive)} />
  </div>;
}

function CrmPipelineWidget({ tenantContext, canViewSensitive }: DashboardWidgetComponentProps) {
  const token = useDashboardToken();
  const query = useQuery({
    queryKey: ['dashboard-widget-crm', tenantContext.tenantId], enabled: !!token && !!tenantContext.tenantId, staleTime: 60000,
    queryFn: async () => { const res = await fetch('/api/crm/dashboard/', { headers: buildHeaders(token) }); if (!res.ok) throw new Error(`${res.status}`); return res.json(); },
  });
  const summary = query.data?.summary ?? {};
  return <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
    <MetricTile label="Open opportunities" value={Number(summary.open_opportunities || 0)} />
    <MetricTile label="Pipeline value" value={formatMoney(Number(summary.pipeline_value || 0), tenantContext, !canViewSensitive)} tone="positive" />
    <MetricTile label="Overdue follow-ups" value={Number(summary.overdue_follow_ups || 0)} tone="warning" />
    <MetricTile label="Closing this week" value={Number(summary.closing_soon || 0)} />
  </div>;
}

function ProcurementPulseWidget({ tenantContext, canViewSensitive }: DashboardWidgetComponentProps) {
  const token = useDashboardToken();
  const query = useQuery({
    queryKey: ['dashboard-widget-procurement-pulse', tenantContext.tenantId], enabled: !!token && !!tenantContext.tenantId, staleTime: 60000,
    queryFn: async () => { const res = await fetch('/api/procurement/dashboard/', { headers: buildHeaders(token) }); if (!res.ok) throw new Error(`${res.status}`); return res.json(); },
  });
  const data = query.data ?? {};
  return <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
    <MetricTile label="Submitted POs" value={Number(data.counts?.submitted || 0)} tone="warning" />
    <MetricTile label="Approved POs" value={Number(data.counts?.approved || 0)} tone="positive" />
    <MetricTile label="Blocked requisitions" value={Number(data.requisitions?.blocked || 0)} tone="warning" />
    <MetricTile label="Approved value" value={formatMoney(Number(data.total_value || 0), tenantContext, !canViewSensitive)} />
  </div>;
}

function SupportPulseWidget({ tenantContext }: DashboardWidgetComponentProps) {
  const token = useDashboardToken();
  const query = useQuery({
    queryKey: ['dashboard-widget-ticketing', tenantContext.tenantId], enabled: !!token && !!tenantContext.tenantId, staleTime: 30000,
    queryFn: async () => { const res = await fetch('/api/ticketing/dashboard/', { headers: buildHeaders(token) }); if (!res.ok) throw new Error(`${res.status}`); return res.json(); },
  });
  const counts = query.data?.counts ?? {};
  return <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
    <MetricTile label="Open tickets" value={Number(counts.open || 0)} tone="warning" />
    <MetricTile label="High priority" value={Number(counts.high_priority || 0)} tone="warning" />
    <MetricTile label="Unassigned" value={Number(counts.unassigned || 0)} />
    <MetricTile label="Resolved" value={Number(counts.resolved || 0)} tone="positive" />
  </div>;
}

function PeoplePulseWidget({ tenantContext }: DashboardWidgetComponentProps) {
  const token = useDashboardToken();
  const query = useQuery({
    queryKey: ['dashboard-widget-hr', tenantContext.tenantId], enabled: !!token && !!tenantContext.tenantId, staleTime: 60000,
    queryFn: async () => { const res = await fetch('/api/hr/dashboard/', { headers: buildHeaders(token) }); if (!res.ok) throw new Error(`${res.status}`); return res.json(); },
  });
  const staff = query.data?.staff ?? {}; const payroll = query.data?.payroll ?? {};
  return <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
    <MetricTile label="Active staff" value={Number(staff.active || 0)} tone="positive" />
    <MetricTile label="Inactive staff" value={Number(staff.inactive || 0)} />
    <MetricTile label="Payroll completed" value={`${Number(payroll.completed_periods || 0)} / ${Number(payroll.total_periods || 0)}`} />
    <MetricTile label="Administrators" value={Number(staff.admins || 0)} />
  </div>;
}

function BudgetPulseWidget({ tenantContext, canViewSensitive }: DashboardWidgetComponentProps) {
  const token = useDashboardToken();
  const query = useQuery({
    queryKey: ['dashboard-widget-budgeting', tenantContext.tenantId], enabled: !!token && !!tenantContext.tenantId, staleTime: 60000,
    queryFn: async () => { const res = await fetch('/api/budgeting/dashboard/', { headers: buildHeaders(token) }); if (!res.ok) throw new Error(`${res.status}`); return res.json(); },
  });
  const data = query.data ?? {}; const totals = data.totals ?? {};
  return <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
    <MetricTile label="Active budgets" value={Number(data.counts?.active_budgets || 0)} />
    <MetricTile label="Available budget" value={formatMoney(Number(totals.available || 0), tenantContext, !canViewSensitive)} tone="positive" />
    <MetricTile label="Committed" value={formatMoney(Number(totals.committed || 0), tenantContext, !canViewSensitive)} tone="warning" />
    <MetricTile label="Actual spend" value={formatMoney(Number(totals.actual || 0), tenantContext, !canViewSensitive)} />
  </div>;
}

function SalesPulseWidget({ tenantContext, canViewSensitive }: DashboardWidgetComponentProps) {
  const token = useDashboardToken();
  const query = useQuery({
    queryKey: ['dashboard-widget-sales', tenantContext.tenantId], enabled: !!token && !!tenantContext.tenantId, staleTime: 60000,
    queryFn: async () => { const res = await fetch('/api/sales/dashboard/', { headers: buildHeaders(token) }); if (!res.ok) throw new Error(`${res.status}`); return res.json(); },
  });
  const data = query.data ?? {}; const counts = data.counts ?? {}; const totals = data.totals ?? {};
  return <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
    <MetricTile label="Open orders" value={Number(counts.open_orders || 0)} tone="warning" />
    <MetricTile label="Confirmed orders" value={Number(counts.confirmed_orders || 0)} tone="positive" />
    <MetricTile label="Estimate pipeline" value={formatMoney(Number(totals.estimate_pipeline || 0), tenantContext, !canViewSensitive)} />
    <MetricTile label="Open order value" value={formatMoney(Number(totals.open_order_value || 0), tenantContext, !canViewSensitive)} tone="positive" />
  </div>;
}

export const DASHBOARD_WIDGETS: DashboardWidgetDefinition[] = [
  {
    id: 'hero',
    title: 'Business Overview',
    description: 'Role-aware operational overview for the current tenant and assigned branches.',
    category: 'overview',
    requiredPermissions: ['view_dashboard'],
    defaultLayout: { widgetId: 'hero', x: 0, y: 0, w: 12, h: 2, isCollapsed: false, isEnabled: true },
    component: HeroWidget,
  },
  {
    id: 'company-health',
    title: 'Company Health',
    description: 'Unified finance and supply-chain pulse with tenant-safe analytics.',
    category: 'analytics',
    requiredPermissions: ['view_company_health', 'view_financials', 'view_supply_chain'],
    moduleDependencies: ['accounting', 'procurement'],
    workspacePermissions: ['can_view_finance_overview', 'can_view_procurement_overview'],
    defaultLayout: { widgetId: 'company-health', x: 0, y: 3, w: 7, h: 4, isCollapsed: false, isEnabled: true },
    component: CompanyHealthWidget,
  },
  {
    id: 'actionable-insights',
    title: 'Workflow Notifications',
    description: 'Operational alerts and workflow-driven issues that need follow-up.',
    category: 'operations',
    requiredPermissions: ['view_operational_alerts'],
    moduleDependencies: ['weighbridge', 'accounting', 'procurement'],
    workspacePermissions: ['can_view_weighbridge_overview', 'can_view_finance_overview', 'can_view_procurement_overview'],
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
    defaultLayout: { widgetId: 'module-map', x: 4, y: 7, w: 4, h: 5, isCollapsed: false, isEnabled: false },
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
    workspacePermissions: ['can_view_finance_overview'],
    defaultLayout: { widgetId: 'finance-pulse', x: 0, y: 12, w: 6, h: 4, isCollapsed: false, isEnabled: true },
    component: FinancePulseWidget,
  },
  {
    id: 'operations-pulse',
    title: 'Weighbridge Performance',
    description: 'Live business throughput, payments, completed charges, and daily activity trend.',
    category: 'operations',
    requiredPermissions: ['view_dashboard'],
    moduleDependencies: ['weighbridge'],
    workspacePermissions: ['can_view_weighbridge_overview'],
    defaultLayout: { widgetId: 'operations-pulse', x: 0, y: 2, w: 12, h: 5, isCollapsed: false, isEnabled: true },
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
  {
    id: 'inventory-pulse', title: 'Inventory Control', description: 'Stock availability, reservations, warehouses, and valuation.', category: 'operations',
    requiredPermissions: ['view_dashboard'], workspacePermissions: ['can_view_inventory_overview'], moduleDependencies: ['inventory'],
    defaultLayout: { widgetId: 'inventory-pulse', x: 0, y: 19, w: 6, h: 4, isCollapsed: false, isEnabled: true }, component: InventoryPulseWidget,
  },
  {
    id: 'crm-pipeline', title: 'CRM Pipeline', description: 'Opportunity value, follow-ups, and closing activity.', category: 'analytics',
    requiredPermissions: ['view_dashboard'], workspacePermissions: ['can_view_crm_overview'], moduleDependencies: ['crm'],
    defaultLayout: { widgetId: 'crm-pipeline', x: 6, y: 19, w: 6, h: 4, isCollapsed: false, isEnabled: true }, component: CrmPipelineWidget,
  },
  {
    id: 'procurement-pulse', title: 'Procurement Execution', description: 'Purchase orders, requisitions, budgets, and committed value.', category: 'operations',
    requiredPermissions: ['view_dashboard'], workspacePermissions: ['can_view_procurement_overview'], moduleDependencies: ['procurement'],
    defaultLayout: { widgetId: 'procurement-pulse', x: 0, y: 23, w: 6, h: 4, isCollapsed: false, isEnabled: true }, component: ProcurementPulseWidget,
  },
  {
    id: 'support-pulse', title: 'Customer Support', description: 'Support workload, priority queues, ownership, and resolution progress.', category: 'workflows',
    requiredPermissions: ['view_dashboard'], workspacePermissions: ['can_view_ticketing_overview'], moduleDependencies: ['ticketing'],
    defaultLayout: { widgetId: 'support-pulse', x: 6, y: 23, w: 6, h: 4, isCollapsed: false, isEnabled: true }, component: SupportPulseWidget,
  },
  {
    id: 'people-pulse', title: 'People & Payroll', description: 'Staff availability, administration, and payroll-cycle progress.', category: 'overview',
    requiredPermissions: ['view_dashboard'], workspacePermissions: ['can_view_hr_overview'], moduleDependencies: ['hr-payroll'],
    defaultLayout: { widgetId: 'people-pulse', x: 0, y: 27, w: 6, h: 4, isCollapsed: false, isEnabled: true }, component: PeoplePulseWidget,
  },
  {
    id: 'budget-pulse', title: 'Budget Control', description: 'Budget allocation, commitments, actual spend, and available balance.', category: 'analytics',
    requiredPermissions: ['view_financials'], workspacePermissions: ['can_view_budgeting_overview'], moduleDependencies: ['budgeting'],
    defaultLayout: { widgetId: 'budget-pulse', x: 6, y: 27, w: 6, h: 4, isCollapsed: false, isEnabled: true }, component: BudgetPulseWidget,
  },
  {
    id: 'sales-pulse', title: 'Sales Pipeline', description: 'Orders, estimates, recurring revenue, and sales pipeline value.', category: 'analytics',
    requiredPermissions: ['view_financials'], workspacePermissions: ['can_view_sales_overview'], moduleDependencies: ['sales'],
    defaultLayout: { widgetId: 'sales-pulse', x: 0, y: 31, w: 6, h: 4, isCollapsed: false, isEnabled: true }, component: SalesPulseWidget,
  },
];
