import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  ClipboardCheck,
  Clock3,
  FolderKanban,
  LayoutGrid,
  ReceiptText,
  Scale,
  TrendingUp,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/context/use-auth';
import { useDashboardAccess } from '@/hooks/use-dashboard-access';
import { useTenantTheme } from '@/hooks/use-tenant-theme';
import { ERPMetricCard } from '@/components/erp/workspace/workspace-ui';

function buildHeaders(token: string | null) {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Token ${token}`;
  return headers;
}

function formatDate(value: string | null | undefined, locale: string, timezone: string) {
  if (!value) return '—';
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: timezone,
  }).format(new Date(value));
}

function formatMoney(value: number, currency: string, locale: string, masked: boolean) {
  if (masked) return '••••••';
  return `${currency} ${value.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function moduleIcon(key: string) {
  if (key.includes('weighbridge')) return Scale;
  if (key.includes('finance') || key.includes('accounting')) return ReceiptText;
  if (key.includes('workflow')) return ClipboardCheck;
  return LayoutGrid;
}

type WorkflowInboxResponse = {
  results?: Array<{
    id: number;
    title?: string;
    detail?: string;
    reference?: string;
    route_path?: string;
    created_at?: string;
    updated_at?: string;
  }>;
};

type AuditEventRow = {
  id: number;
  object_repr?: string;
  model_label?: string;
  event_type?: string;
  event_group?: string;
  note?: string;
  actor_name?: string;
  status?: string;
  created_at?: string;
};

type WeighbridgeDashboardResponse = {
  totals?: {
    transactions_today?: number;
    pending_payments?: number;
  };
  recent_transactions?: Array<{
    id: number;
    vehicle_plate?: string;
    customer_name?: string;
    status?: string;
    created_at?: string;
    net_weight?: number | null;
  }>;
};

type AccountingDashboardResponse = {
  invoices?: {
    outstanding?: number;
  };
};

type ProcurementDashboardResponse = {
  counts?: {
    submitted?: number;
  };
  requisitions?: {
    blocked?: number;
  };
};

type RecentItem = {
  id: string;
  title: string;
  detail: string;
  href: string;
  badge: string;
  timestamp?: string;
};

function DashboardChart({
  title,
  values,
  mode = 'line',
}: {
  title: string;
  values: number[];
  mode?: 'line' | 'bar';
}) {
  const maxValue = Math.max(...values, 1);
  const points = values.map((value, index) => {
    const x = (index / Math.max(values.length - 1, 1)) * 100;
    const y = 86 - (value / maxValue) * 68;
    return `${x},${y}`;
  }).join(' ');

  return (
    <Card className="overflow-hidden border-border/70 shadow-sm">
      <CardHeader className="flex-row items-center justify-between border-b bg-muted/15 px-4 py-3">
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
        <span className="text-[11px] text-muted-foreground">Last 7 days</span>
      </CardHeader>
      <CardContent className="p-4">
        <div className="h-36">
          {mode === 'bar' ? (
            <div className="flex h-full items-end gap-3 border-b border-dashed border-border/80 px-3 pb-2">
              {values.map((value, index) => (
                <div key={index} className="flex h-full flex-1 items-end justify-center">
                  <div
                    className="w-full max-w-8 rounded-t-sm bg-emerald-500/85 transition-all"
                    style={{ height: `${Math.max((value / maxValue) * 100, value > 0 ? 8 : 2)}%` }}
                  />
                </div>
              ))}
            </div>
          ) : (
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full overflow-visible">
              {[22, 45, 68, 91].map((line) => (
                <line key={line} x1="0" y1={line} x2="100" y2={line} stroke="currentColor" className="text-border/70" strokeDasharray="1 2" vectorEffect="non-scaling-stroke" />
              ))}
              <polyline points={points} fill="none" stroke="hsl(var(--primary))" strokeWidth="2" vectorEffect="non-scaling-stroke" />
              {values.map((value, index) => {
                const x = (index / Math.max(values.length - 1, 1)) * 100;
                const y = 86 - (value / maxValue) * 68;
                return <circle key={index} cx={x} cy={y} r="2" fill="hsl(var(--primary))" vectorEffect="non-scaling-stroke" />;
              })}
            </svg>
          )}
        </div>
        <div className="mt-2 grid grid-cols-7 text-center text-[10px] text-muted-foreground">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => <span key={day}>{day}</span>)}
        </div>
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const { token, user } = useAuth();
  const { tenantContext, isLoading } = useTenantTheme();
  const { hasPermission, canViewSensitive } = useDashboardAccess();

  const hasWeighbridge = tenantContext.sections.some((section) => section.key === 'weighbridge');
  const hasProcurement = tenantContext.sections.some((section) => section.key === 'procurement');
  const canViewFinance = hasPermission('view_financials');
  const canViewWorkflow = hasPermission('view_workflow_inbox');
  const canViewAudit = hasPermission('view_audit_trail');

  const workflowInboxQuery = useQuery({
    queryKey: ['dashboard-simple-workflow-inbox', tenantContext.tenantId],
    enabled: !!token && canViewWorkflow,
    staleTime: 30000,
    queryFn: async () => {
      const res = await fetch('/api/platform/workflows/inbox/', { headers: buildHeaders(token) });
      if (!res.ok) throw new Error(`${res.status}`);
      const json = await res.json();
      return (json?.data ?? json) as WorkflowInboxResponse;
    },
  });

  const auditQuery = useQuery({
    queryKey: ['dashboard-simple-audit', tenantContext.tenantId],
    enabled: !!token && canViewAudit,
    staleTime: 60000,
    queryFn: async () => {
      const res = await fetch('/api/platform/audit/events/?limit=6', { headers: buildHeaders(token) });
      if (!res.ok) throw new Error(`${res.status}`);
      const json = await res.json();
      return (json?.data ?? json) as AuditEventRow[];
    },
  });

  const weighbridgeQuery = useQuery({
    queryKey: ['dashboard-simple-weighbridge', tenantContext.tenantId],
    enabled: !!token && hasWeighbridge,
    staleTime: 60000,
    queryFn: async () => {
      const res = await fetch('/api/commercial-weighbridge/dashboard/', { headers: buildHeaders(token) });
      if (!res.ok) throw new Error(`${res.status}`);
      return (await res.json()) as WeighbridgeDashboardResponse;
    },
  });

  const accountingQuery = useQuery({
    queryKey: ['dashboard-simple-accounting', tenantContext.tenantId],
    enabled: !!token && canViewFinance,
    staleTime: 60000,
    queryFn: async () => {
      const res = await fetch('/api/accounting/dashboard/', { headers: buildHeaders(token) });
      if (!res.ok) throw new Error(`${res.status}`);
      return (await res.json()) as AccountingDashboardResponse;
    },
  });

  const procurementQuery = useQuery({
    queryKey: ['dashboard-simple-procurement', tenantContext.tenantId],
    enabled: !!token && hasProcurement,
    staleTime: 60000,
    queryFn: async () => {
      const res = await fetch('/api/procurement/dashboard/', { headers: buildHeaders(token) });
      if (!res.ok) throw new Error(`${res.status}`);
      return (await res.json()) as ProcurementDashboardResponse;
    },
  });

  const moduleCards = useMemo(() => {
    const items: Array<{ label: string; value: string; tone?: 'default' | 'positive' | 'warning' }> = [
      {
        label: 'Active Modules',
        value: String(tenantContext.activeModuleSlugs.length || tenantContext.sections.length),
        tone: 'positive',
      },
      {
        label: 'Workspace Sections',
        value: String(tenantContext.sections.length),
      },
      {
        label: 'Quick Links',
        value: String(tenantContext.sections.reduce((sum, section) => sum + section.items.length, 0)),
      },
    ];

    if (canViewWorkflow) {
      items.push({
        label: 'Pending Approvals',
        value: String(workflowInboxQuery.data?.results?.length ?? 0),
        tone: 'warning',
      });
    } else if (hasWeighbridge) {
      items.push({
        label: 'Bridge Today',
        value: String(weighbridgeQuery.data?.totals?.transactions_today ?? 0),
        tone: 'positive',
      });
    }

    if (canViewFinance) {
      items.push({
        label: 'Outstanding',
        value: formatMoney(
          Number(accountingQuery.data?.invoices?.outstanding ?? 0),
          tenantContext.branding.currency,
          tenantContext.branding.locale,
          !canViewSensitive,
        ),
        tone: 'warning',
      });
    }

    if (hasWeighbridge) {
      items.push({
        label: 'Pending Payments',
        value: String(weighbridgeQuery.data?.totals?.pending_payments ?? 0),
        tone: 'warning',
      });
    }

    return items.slice(0, 4);
  }, [
    accountingQuery.data,
    canViewFinance,
    canViewSensitive,
    canViewWorkflow,
    hasWeighbridge,
    tenantContext.activeModuleSlugs.length,
    tenantContext.branding.currency,
    tenantContext.branding.locale,
    tenantContext.sections,
    weighbridgeQuery.data,
    workflowInboxQuery.data,
  ]);

  const quickLinks = useMemo(() => {
    return tenantContext.sections
      .filter((section) => section.items.length > 0)
      .map((section) => ({
        key: section.key,
        title: section.title,
        href: section.items[0]?.path || '/dashboard',
        count: section.items.length,
      }))
      .slice(0, 8);
  }, [tenantContext.sections]);

  const workflowAlerts = useMemo(() => {
    const items: Array<{ title: string; detail: string; href: string; tone: 'info' | 'warning' | 'critical' }> = [];

    const pendingPayments = Number(weighbridgeQuery.data?.totals?.pending_payments ?? 0);
    const submittedPos = Number(procurementQuery.data?.counts?.submitted ?? 0);
    const blockedReqs = Number(procurementQuery.data?.requisitions?.blocked ?? 0);
    const outstanding = Number(accountingQuery.data?.invoices?.outstanding ?? 0);

    if (blockedReqs > 0) {
      items.push({
        title: `${blockedReqs} requisition${blockedReqs === 1 ? '' : 's'} blocked`,
        detail: 'Budget or approval controls are holding procurement flow.',
        href: '/procurement/requisitions',
        tone: 'critical',
      });
    }
    if (submittedPos > 0) {
      items.push({
        title: `${submittedPos} purchase order${submittedPos === 1 ? '' : 's'} waiting`,
        detail: 'Supplier approvals still need follow-up.',
        href: '/procurement/purchase-orders',
        tone: 'warning',
      });
    }
    if (pendingPayments > 0) {
      items.push({
        title: `${pendingPayments} weighbridge payment${pendingPayments === 1 ? '' : 's'} pending`,
        detail: 'Pending settlement can delay downstream posting.',
        href: '/weighbridge/transactions',
        tone: 'warning',
      });
    }
    if (outstanding > 0 && canViewFinance) {
      items.push({
        title: 'Receivables need collection follow-up',
        detail: `${formatMoney(outstanding, tenantContext.branding.currency, tenantContext.branding.locale, !canViewSensitive)} remains outstanding.`,
        href: '/accounting/dashboard',
        tone: 'info',
      });
    }

    if (!items.length) {
      items.push({
        title: 'No workflow blockers right now',
        detail: 'Current approvals and downstream actions are within expected thresholds.',
        href: '/platform/workflows',
        tone: 'info',
      });
    }

    return items.slice(0, 5);
  }, [
    accountingQuery.data,
    canViewFinance,
    canViewSensitive,
    procurementQuery.data,
    tenantContext.branding.currency,
    tenantContext.branding.locale,
    weighbridgeQuery.data,
  ]);

  const recentItems = useMemo<RecentItem[]>(() => {
    const items: RecentItem[] = [];

    (workflowInboxQuery.data?.results ?? []).slice(0, 4).forEach((item) => {
      items.push({
        id: `workflow-${item.id}`,
        title: item.title || 'Workflow request',
        detail: item.detail || item.reference || 'Approval item waiting for action.',
        href: item.route_path || '/platform/workflows',
        badge: 'Workflow',
        timestamp: item.updated_at || item.created_at,
      });
    });

    (weighbridgeQuery.data?.recent_transactions ?? []).slice(0, 4).forEach((item) => {
      items.push({
        id: `weighbridge-${item.id}`,
        title: item.vehicle_plate || `Transaction #${item.id}`,
        detail: `${item.customer_name || 'Weighbridge'} · ${item.status || 'Recorded'}${item.net_weight ? ` · ${item.net_weight} kg` : ''}`,
        href: `/weighbridge/transactions/${item.id}`,
        badge: 'Weighbridge',
        timestamp: item.created_at,
      });
    });

    (auditQuery.data ?? []).slice(0, 4).forEach((item) => {
      items.push({
        id: `audit-${item.id}`,
        title: item.object_repr || item.model_label || item.event_type || 'Audit event',
        detail: item.note || `${item.event_group || 'audit'} · ${item.event_type || 'logged'}`,
        href: '/platform/audit',
        badge: 'Audit',
        timestamp: item.created_at,
      });
    });

    return items
      .sort((a, b) => {
        const left = a.timestamp ? Date.parse(a.timestamp) : 0;
        const right = b.timestamp ? Date.parse(b.timestamp) : 0;
        return right - left;
      })
      .slice(0, 8);
  }, [auditQuery.data, weighbridgeQuery.data, workflowInboxQuery.data]);

  const weeklyActivity = useMemo(() => {
    const now = new Date();
    const days = Array.from({ length: 7 }, (_, index) => {
      const day = new Date(now);
      day.setDate(now.getDate() - (6 - index));
      return day.toDateString();
    });
    const values = days.map((day) => (weighbridgeQuery.data?.recent_transactions ?? []).filter((transaction) =>
      transaction.created_at && new Date(transaction.created_at).toDateString() === day,
    ).length);
    return values.some(Boolean) ? values : [0, 0, 0, 0, 0, 0, 0];
  }, [weighbridgeQuery.data]);

  const greetingName = String((user as any)?.first_name || (user as any)?.username || tenantContext.tenantName || 'there');
  const today = new Intl.DateTimeFormat(tenantContext.branding.locale || 'en-KE', {
    weekday: 'long', day: '2-digit', month: 'short', year: 'numeric', timeZone: tenantContext.branding.timezone,
  }).format(new Date());

  if (isLoading) {
    return <div className="p-12 text-center font-mono text-sm text-muted-foreground animate-pulse">Loading dashboard…</div>;
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-border/80 pb-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Good morning, {greetingName}</h1>
          <p className="mt-1 text-xs text-muted-foreground">Here is what is happening across your business today.</p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-xs text-muted-foreground shadow-sm">
          <CalendarDays className="h-3.5 w-3.5 text-primary" />{today}
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {moduleCards.map((card) => (
          <ERPMetricCard
            key={card.label}
            label={card.label}
            value={card.value}
            detail={card.tone === 'positive' ? 'Up to date' : card.tone === 'warning' ? 'Needs attention' : 'Workspace total'}
          />
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <DashboardChart title="Operational Trend" values={weeklyActivity} />
        <DashboardChart title="Activity Overview" values={weeklyActivity.map((value, index) => value + (index % 3 === 0 ? 1 : 0))} mode="bar" />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="overflow-hidden border-border/70 shadow-sm">
          <CardHeader className="flex-row items-center justify-between border-b bg-muted/15 px-4 py-3">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold"><AlertTriangle className="h-4 w-4 text-primary" />Requires Attention</CardTitle>
            <Link href="/platform/workflows" className="text-xs font-medium text-primary hover:underline">View all</Link>
          </CardHeader>
          <CardContent className="divide-y p-0">
            {workflowAlerts.map((item) => (
              <Link key={item.title} href={item.href} className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-muted/30">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{item.title}</p>
                  <p className="truncate text-xs text-muted-foreground">{item.detail}</p>
                </div>
                <span className={`h-2 w-2 shrink-0 rounded-full ${item.tone === 'critical' ? 'bg-red-500' : item.tone === 'warning' ? 'bg-amber-500' : 'bg-sky-500'}`} />
              </Link>
            ))}
          </CardContent>
        </Card>

        <Card className="overflow-hidden border-border/70 shadow-sm">
          <CardHeader className="flex-row items-center justify-between border-b bg-muted/15 px-4 py-3">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold"><Clock3 className="h-4 w-4 text-primary" />Recent Activity</CardTitle>
            <Link href={hasWeighbridge ? '/weighbridge/transactions' : '/platform/audit'} className="text-xs font-medium text-primary hover:underline">View all</Link>
          </CardHeader>
          <CardContent className="divide-y p-0">
            {recentItems.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-muted-foreground">No recent activity for this workspace yet.</p>
            ) : recentItems.slice(0, 5).map((item) => (
              <Link key={item.id} href={item.href} className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-muted/30">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{item.title}</p>
                  <p className="truncate text-xs text-muted-foreground">{item.detail}</p>
                </div>
                <span className="shrink-0 text-[11px] text-muted-foreground">{formatDate(item.timestamp, tenantContext.branding.locale, tenantContext.branding.timezone)}</span>
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card className="overflow-hidden border-border/70 shadow-sm">
        <CardHeader className="flex-row items-center justify-between border-b bg-muted/15 px-4 py-3">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold"><FolderKanban className="h-4 w-4 text-primary" />Workspace Shortcuts</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 p-3 sm:grid-cols-2 xl:grid-cols-4">
          {quickLinks.slice(0, 8).map((item) => {
            const Icon = moduleIcon(item.key);
            return (
              <Link key={item.key} href={item.href} className="flex items-center gap-3 rounded-lg border border-border/70 px-3 py-3 transition-colors hover:border-primary/40 hover:bg-primary/5">
                <Icon className="h-4 w-4 text-primary" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{item.title}</span>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
              </Link>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
