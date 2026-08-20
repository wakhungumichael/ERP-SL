import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
import {
  ArrowRight,
  ClipboardCheck,
  Clock3,
  FolderKanban,
  History,
  LayoutGrid,
  ReceiptText,
  Scale,
  ShieldCheck,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/context/use-auth';
import { useDashboardAccess } from '@/hooks/use-dashboard-access';
import { useTenantTheme } from '@/hooks/use-tenant-theme';

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

export default function Dashboard() {
  const { token } = useAuth();
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

  if (isLoading) {
    return <div className="p-12 text-center font-mono text-sm text-muted-foreground animate-pulse">Loading dashboard…</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between border-b pb-4">
        <div className="space-y-2">
          <Badge className="bg-primary/10 text-primary hover:bg-primary/10">Dashboard</Badge>
          <h1 className="text-3xl font-black tracking-tight lg:text-4xl">{tenantContext.tenantName}</h1>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(340px,0.9fr)]">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-2">
          {moduleCards.map((card) => (
            <div
              key={card.label}
              className={[
                'rounded-2xl border bg-card p-4 shadow-sm',
                card.tone === 'positive' ? 'border-emerald-200 bg-emerald-50/60' : '',
                card.tone === 'warning' ? 'border-amber-200 bg-amber-50/60' : '',
              ].join(' ')}
            >
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">{card.label}</div>
              <div className="mt-2 text-2xl font-black tracking-tight">{card.value}</div>
            </div>
          ))}
        </div>

        <Card className="border-border/70 shadow-sm self-start">
          <CardHeader className="border-b bg-muted/15">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Clock3 className="h-4 w-4 text-primary" />
              Recent Items
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 p-4">
            {recentItems.length === 0 ? (
              <div className="rounded-2xl border border-dashed p-5 text-sm text-muted-foreground">
                No recent items are available for this tenant and role yet.
              </div>
            ) : (
              recentItems.slice(0, 5).map((item) => (
                <Link key={item.id} href={item.href} className="block rounded-2xl border border-border/70 p-4 transition-colors hover:bg-muted/20">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate font-semibold">{item.title}</div>
                      <p className="mt-1 text-sm text-muted-foreground">{item.detail}</p>
                    </div>
                    <Badge variant="outline">{item.badge}</Badge>
                  </div>
                  <div className="mt-3 text-xs text-muted-foreground">
                    {formatDate(item.timestamp, tenantContext.branding.locale, tenantContext.branding.timezone)}
                  </div>
                </Link>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(340px,0.85fr)]">
        <Card className="border-border/70 shadow-sm">
          <CardHeader className="border-b bg-muted/15">
            <CardTitle className="flex items-center gap-2 text-lg">
              <FolderKanban className="h-4 w-4 text-primary" />
              Quick Links To Modules
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 p-4 md:grid-cols-2">
            {quickLinks.map((item) => {
              const Icon = moduleIcon(item.key);
              return (
                <Link key={item.key} href={item.href} className="flex items-center gap-3 rounded-2xl border border-border/70 p-4 transition-colors hover:bg-muted/20">
                  <div className="rounded-xl bg-primary/10 p-2 text-primary">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold">{item.title}</div>
                    <div className="text-sm text-muted-foreground">{item.count} linked page{item.count === 1 ? '' : 's'}</div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                </Link>
              );
            })}
          </CardContent>
        </Card>

        <Card className="border-border/70 shadow-sm">
          <CardHeader className="border-b bg-muted/15">
            <CardTitle className="flex items-center gap-2 text-lg">
              <ClipboardCheck className="h-4 w-4 text-primary" />
              Workflow Tabs
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            <Tabs defaultValue="approvals" className="space-y-4">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="approvals">Approvals</TabsTrigger>
                <TabsTrigger value="alerts">Operational Alerts</TabsTrigger>
              </TabsList>

              <TabsContent value="approvals" className="space-y-3">
                {!canViewWorkflow ? (
                  <div className="rounded-2xl border border-dashed p-5 text-sm text-muted-foreground">
                    Approval items are not visible for the current user role.
                  </div>
                ) : (workflowInboxQuery.data?.results?.length ?? 0) === 0 ? (
                  <div className="rounded-2xl border border-dashed p-5 text-sm text-muted-foreground">
                    No workflow approvals are waiting for you right now.
                  </div>
                ) : (
                  (workflowInboxQuery.data?.results ?? []).slice(0, 4).map((item) => (
                    <Link key={item.id} href={item.route_path || '/platform/workflows'} className="block rounded-2xl border border-border/70 p-4 transition-colors hover:bg-muted/20">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-semibold">{item.title || 'Approval item'}</div>
                          <p className="mt-1 text-sm text-muted-foreground">{item.detail || item.reference || 'Pending workflow action.'}</p>
                        </div>
                        <Badge variant="secondary">{item.reference || 'Workflow'}</Badge>
                      </div>
                    </Link>
                  ))
                )}
              </TabsContent>

              <TabsContent value="alerts" className="space-y-3">
                {workflowAlerts.map((item) => (
                  <Link key={item.title} href={item.href} className="block rounded-2xl border border-border/70 p-4 transition-colors hover:bg-muted/20">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold">{item.title}</div>
                        <p className="mt-1 text-sm text-muted-foreground">{item.detail}</p>
                      </div>
                      <Badge
                        className={[
                          item.tone === 'critical' ? 'bg-red-100 text-red-800 hover:bg-red-100' : '',
                          item.tone === 'warning' ? 'bg-amber-100 text-amber-800 hover:bg-amber-100' : '',
                          item.tone === 'info' ? 'bg-sky-100 text-sky-800 hover:bg-sky-100' : '',
                        ].join(' ')}
                      >
                        {item.tone}
                      </Badge>
                    </div>
                  </Link>
                ))}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/70 shadow-sm">
        <CardHeader className="border-b bg-muted/15">
          <CardTitle className="flex items-center gap-2 text-lg">
            <ShieldCheck className="h-4 w-4 text-primary" />
            Audit & Compliance Trail
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 p-4">
          {!canViewAudit ? (
            <div className="rounded-2xl border border-dashed p-5 text-sm text-muted-foreground">
              Audit and compliance events are not visible for the current user role.
            </div>
          ) : (auditQuery.data ?? []).length === 0 ? (
            <div className="rounded-2xl border border-dashed p-5 text-sm text-muted-foreground">
              No recent audit events are visible for this tenant scope.
            </div>
          ) : (
            (auditQuery.data ?? []).slice(0, 6).map((row) => (
              <Link key={row.id} href="/platform/audit" className="block rounded-2xl border border-border/70 p-4 transition-colors hover:bg-muted/20">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{row.object_repr || row.model_label || row.event_type || 'Audit event'}</div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {row.note || `${row.event_group || 'audit'} · ${row.event_type || 'logged'}`}
                    </p>
                  </div>
                  <Badge variant="outline">{row.status || 'logged'}</Badge>
                </div>
                <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                  <History className="h-3.5 w-3.5" />
                  {row.actor_name || 'System'} · {formatDate(row.created_at, tenantContext.branding.locale, tenantContext.branding.timezone)}
                </div>
              </Link>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
