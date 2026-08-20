import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
import {
  ArrowRight,
  BellRing,
  Building2,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Mail,
  MessageSquare,
  PackageCheck,
  Phone,
  ShoppingCart,
  Target,
  TrendingUp,
  Users,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

function useCRMDashboard() {
  return useQuery({
    queryKey: ['crm-dashboard'],
    queryFn: async () => {
      const token = localStorage.getItem('sl-erp-token');
      const res = await fetch('/api/crm/dashboard/', { headers: { Authorization: `Token ${token}` } });
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    staleTime: 60_000,
  });
}

const STAGE_COLORS: Record<string, string> = {
  new: 'bg-slate-100 text-slate-700',
  contacted: 'bg-blue-100 text-blue-800',
  proposal: 'bg-purple-100 text-purple-800',
  negotiation: 'bg-orange-100 text-orange-800',
  won: 'bg-emerald-100 text-emerald-800',
  lost: 'bg-red-100 text-red-800',
};

const ACTIVITY_ICONS: Record<string, React.ReactNode> = {
  call: <Phone className="h-3.5 w-3.5" />,
  email: <Mail className="h-3.5 w-3.5" />,
  meeting: <CalendarClock className="h-3.5 w-3.5" />,
  note: <MessageSquare className="h-3.5 w-3.5" />,
  task: <CheckCircle2 className="h-3.5 w-3.5" />,
};

function formatMoney(value: number | null | undefined) {
  return `KES ${Number(value ?? 0).toLocaleString()}`;
}

function formatDate(value?: string | null) {
  if (!value) return 'No date';
  return new Date(value).toLocaleDateString();
}

function QueueEmpty({ label }: { label: string }) {
  return <div className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">{label}</div>;
}

export default function CRMDashboard() {
  const { data, isLoading } = useCRMDashboard();

  if (isLoading) {
    return <div className="p-12 text-center font-mono text-sm text-muted-foreground animate-pulse">Loading CRM dashboard…</div>;
  }

  const summary = data?.summary ?? {};
  const stages: any[] = data?.pipeline_stages ?? [];
  const recentFollowUps: any[] = data?.recent_follow_ups ?? [];
  const queues = data?.priority_queues ?? {};
  const staleDeals: any[] = queues.stale_opportunities ?? [];
  const closingSoon: any[] = queues.closing_soon ?? [];
  const overdueFollowUps: any[] = queues.overdue_follow_ups ?? [];
  const upcomingFollowUps: any[] = queues.upcoming_follow_ups ?? [];
  const byType: any[] = data?.companies_by_type ?? [];
  const period = data?.period ?? {};

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-3xl border bg-gradient-to-br from-slate-950 via-slate-900 to-sky-950 text-white shadow-sm">
        <div className="grid gap-6 p-6 lg:grid-cols-[1.5fr_0.9fr] lg:p-8">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.24em] text-sky-100">
              CRM Overview
            </div>
            <h1 className="mt-4 max-w-3xl text-3xl font-black tracking-tight lg:text-4xl">
              See your companies, deals, and follow-ups in one clear view.
            </h1>
            <p className="mt-3 max-w-2xl text-sm text-slate-200">
              Focus on what needs attention, what is moving forward, and what should happen next.
            </p>

            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-white/10 p-4">
                <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-300">Pipeline Value</div>
                <div className="mt-2 text-2xl font-black">{formatMoney(summary.pipeline_value)}</div>
                <div className="mt-1 text-xs text-slate-300">{summary.open_opportunities ?? 0} open deals</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/10 p-4">
                <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-300">Needs Attention</div>
                <div className="mt-2 text-2xl font-black">{summary.stale_opportunities ?? 0}</div>
                <div className="mt-1 text-xs text-slate-300">Deals not updated since {period.stale_cutoff || 'recently'}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/10 p-4">
                <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-300">Overdue Follow-ups</div>
                <div className="mt-2 text-2xl font-black">{summary.overdue_follow_ups ?? 0}</div>
                <div className="mt-1 text-xs text-slate-300">Activities that need attention today</div>
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/10 p-5">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-300">Next Actions</div>
                <p className="mt-1 text-sm text-slate-200">Jump straight to the work that matters most.</p>
              </div>
              <BellRing className="h-5 w-5 text-sky-200" />
            </div>
            <div className="mt-4 grid gap-3">
              <Link href="/crm/follow-ups" className="rounded-2xl border border-white/10 bg-slate-950/30 p-4 transition-colors hover:bg-slate-950/40">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">Recover overdue follow-ups</div>
                    <div className="mt-1 text-xs text-slate-300">{summary.overdue_follow_ups ?? 0} follow-ups are already late.</div>
                  </div>
                  <ArrowRight className="h-4 w-4 shrink-0 text-slate-200" />
                </div>
              </Link>
              <Link href="/sales/estimates" className="rounded-2xl border border-white/10 bg-slate-950/30 p-4 transition-colors hover:bg-slate-950/40">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">Turn deals into quotes</div>
                    <div className="mt-1 text-xs text-slate-300">Move proposal work into formal quotes.</div>
                  </div>
                  <ArrowRight className="h-4 w-4 shrink-0 text-slate-200" />
                </div>
              </Link>
              <Link href="/sales/orders" className="rounded-2xl border border-white/10 bg-slate-950/30 p-4 transition-colors hover:bg-slate-950/40">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">Start work on won deals</div>
                    <div className="mt-1 text-xs text-slate-300">{summary.won_this_month ?? 0} deals won this month are ready for order processing.</div>
                  </div>
                  <ArrowRight className="h-4 w-4 shrink-0 text-slate-200" />
                </div>
              </Link>
            </div>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4 xl:grid-cols-7">
        {[
          { label: 'Companies', value: summary.companies, icon: <Building2 className="h-4 w-4 text-sky-600" />, href: '/crm/companies' },
          { label: 'People', value: summary.people, icon: <Users className="h-4 w-4 text-indigo-600" />, href: '/crm/people' },
          { label: 'Suppliers', value: summary.suppliers, icon: <Building2 className="h-4 w-4 text-amber-600" />, href: '/crm/suppliers' },
          { label: 'Open Deals', value: summary.open_opportunities, icon: <TrendingUp className="h-4 w-4 text-emerald-600" />, href: '/crm/opportunities' },
          { label: 'Won This Month', value: summary.won_this_month, icon: <CheckCircle2 className="h-4 w-4 text-emerald-600" />, href: '/crm/opportunities?stage=won' },
          { label: 'Overdue Follow-ups', value: summary.overdue_follow_ups, icon: <Clock3 className="h-4 w-4 text-rose-600" />, href: '/crm/follow-ups' },
          { label: 'Upcoming 7 Days', value: summary.upcoming_follow_ups, icon: <CalendarClock className="h-4 w-4 text-violet-600" />, href: '/crm/follow-ups' },
        ].map((item) => (
          <Link key={item.label} href={item.href}>
            <Card className="h-full cursor-pointer border-0 shadow-sm ring-1 ring-border/60 transition-all hover:-translate-y-0.5 hover:shadow-md">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">{item.icon}</div>
                <div className="mt-4 text-2xl font-black">{item.value ?? 0}</div>
                <div className="mt-1 text-xs font-medium text-muted-foreground">{item.label}</div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <Card className="shadow-sm">
          <CardHeader className="flex-row items-center justify-between border-b bg-muted/20 py-3">
            <CardTitle className="text-sm font-bold uppercase tracking-widest">Deals by Stage</CardTitle>
            <Link href="/crm/opportunities" className="text-xs text-primary hover:underline">View deals</Link>
          </CardHeader>
          <CardContent className="space-y-3 p-5">
            {stages.map((stage: any) => (
              <div key={stage.stage} className="rounded-2xl border p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${STAGE_COLORS[stage.stage] ?? 'bg-secondary'}`}>
                      {stage.label}
                    </span>
                    <span className="text-lg font-black">{stage.count}</span>
                  </div>
                  <div className="text-sm font-mono text-muted-foreground">{formatMoney(stage.value)}</div>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${Math.min(100, ((stage.value ?? 0) / Math.max(1, summary.pipeline_value ?? 1)) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="flex-row items-center justify-between border-b bg-muted/20 py-3">
            <CardTitle className="text-sm font-bold uppercase tracking-widest">Recent Follow-ups</CardTitle>
            <Link href="/crm/follow-ups" className="text-xs text-primary hover:underline">View all follow-ups</Link>
          </CardHeader>
          <CardContent className="p-0">
            {recentFollowUps.length === 0 ? (
              <QueueEmpty label="No recent follow-ups logged yet." />
            ) : (
              <ul className="divide-y divide-border">
                {recentFollowUps.slice(0, 7).map((item: any) => (
                  <li key={item.id} className="flex items-start gap-3 px-5 py-4">
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                      {ACTIVITY_ICONS[item.type] ?? <MessageSquare className="h-3.5 w-3.5" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{item.summary}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {item.contact_name || item.organisation_name || item.lead_title || 'Unlinked record'}
                      </div>
                    </div>
                    <div className="shrink-0 text-[11px] font-mono text-muted-foreground">{formatDate(item.date)}</div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="shadow-sm">
          <CardHeader className="border-b bg-muted/20 py-3">
            <CardTitle className="text-sm font-bold uppercase tracking-widest">Deals Needing Attention</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 p-5">
            {staleDeals.length === 0 ? (
              <QueueEmpty label="No stale open opportunities right now." />
            ) : staleDeals.map((deal: any) => (
              <div key={deal.id} className="rounded-2xl border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">{deal.title}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{deal.organisation_name || 'Unlinked company'}</div>
                  </div>
                  <span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${STAGE_COLORS[deal.stage] ?? 'bg-secondary'}`}>
                    {deal.stage_display || deal.stage}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span>Value: {formatMoney(Number(deal.value ?? 0))}</span>
                  <span>Close: {formatDate(deal.expected_close_date)}</span>
                  <span>Owner: {deal.assigned_to_name || 'Unassigned'}</span>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Link href="/crm/opportunities">
                    <Button size="sm" className="gap-2">
                      <Target className="h-3.5 w-3.5" />
                      Update Deal
                    </Button>
                  </Link>
                  <Link href="/crm/follow-ups">
                    <Button size="sm" variant="outline">Log Follow-up</Button>
                  </Link>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="border-b bg-muted/20 py-3">
            <CardTitle className="text-sm font-bold uppercase tracking-widest">Closing Soon</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 p-5">
            {closingSoon.length === 0 ? (
              <QueueEmpty label="No open opportunities closing within the next 7 days." />
            ) : closingSoon.map((deal: any) => (
              <div key={deal.id} className="rounded-2xl border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">{deal.title}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{deal.organisation_name || 'Unlinked company'}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-mono font-bold">{formatMoney(Number(deal.value ?? 0))}</div>
                    <div className="text-[11px] text-muted-foreground">{formatDate(deal.expected_close_date)}</div>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Link href={deal.stage === 'won' ? '/sales/orders' : '/sales/estimates'}>
                    <Button size="sm" className="gap-2">
                      {deal.stage === 'won' ? <ShoppingCart className="h-3.5 w-3.5" /> : <TrendingUp className="h-3.5 w-3.5" />}
                      {deal.stage === 'won' ? 'Open Orders' : 'Open Quotes'}
                    </Button>
                  </Link>
                  <Link href="/crm/opportunities">
                    <Button size="sm" variant="outline">Review Deal</Button>
                  </Link>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <Card className="shadow-sm">
          <CardHeader className="border-b bg-muted/20 py-3">
            <CardTitle className="text-sm font-bold uppercase tracking-widest">Follow-ups</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 p-5 md:grid-cols-2">
            <div>
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <Clock3 className="h-4 w-4 text-rose-600" />
                Overdue
              </div>
              <div className="space-y-3">
                {overdueFollowUps.length === 0 ? <QueueEmpty label="No overdue follow-ups." /> : overdueFollowUps.map((item: any) => (
                  <div key={item.id} className="rounded-xl border p-3">
                    <div className="text-sm font-medium">{item.summary}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{item.contact_name || item.organisation_name || item.lead_title || 'Unlinked record'}</div>
                    <div className="mt-2 text-[11px] font-mono text-rose-600">{formatDate(item.date)}</div>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <CalendarClock className="h-4 w-4 text-violet-600" />
                Next 7 Days
              </div>
              <div className="space-y-3">
                {upcomingFollowUps.length === 0 ? <QueueEmpty label="No scheduled follow-ups in the next 7 days." /> : upcomingFollowUps.map((item: any) => (
                  <div key={item.id} className="rounded-xl border p-3">
                    <div className="text-sm font-medium">{item.summary}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{item.contact_name || item.organisation_name || item.lead_title || 'Unlinked record'}</div>
                    <div className="mt-2 text-[11px] font-mono text-violet-600">{formatDate(item.date)}</div>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="flex-row items-center justify-between border-b bg-muted/20 py-3">
            <CardTitle className="text-sm font-bold uppercase tracking-widest">Related Actions</CardTitle>
            <Link href="/sales/orders" className="text-xs text-primary hover:underline">View sales orders</Link>
          </CardHeader>
          <CardContent className="grid gap-4 p-5 md:grid-cols-2">
            {[
              {
                title: 'Quotes',
                text: 'Move proposal and negotiation deals into formal estimates.',
                href: '/sales/estimates',
                icon: <TrendingUp className="h-4 w-4 text-violet-600" />,
              },
              {
                title: 'Orders',
                text: 'Send won deals into sales orders without losing context.',
                href: '/sales/orders',
                icon: <ShoppingCart className="h-4 w-4 text-sky-600" />,
              },
              {
                title: 'Inventory',
                text: 'Check stock, reservations, receipts, and dispatch progress.',
                href: '/inventory/overview',
                icon: <PackageCheck className="h-4 w-4 text-emerald-600" />,
              },
              {
                title: 'Customers',
                text: 'Keep CRM company records aligned with customer records used in sales and billing.',
                href: '/sales/customers',
                icon: <Building2 className="h-4 w-4 text-amber-600" />,
              },
            ].map((item) => (
              <Link key={item.title} href={item.href} className="rounded-2xl border p-4 transition-colors hover:bg-muted/30">
                <div className="mb-3 inline-flex rounded-full bg-muted p-2">{item.icon}</div>
                <div className="font-semibold">{item.title}</div>
                <div className="mt-1 text-sm text-muted-foreground">{item.text}</div>
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>

      {byType.length > 0 && (
        <Card className="shadow-sm">
          <CardHeader className="border-b bg-muted/20 py-3">
            <CardTitle className="text-sm font-bold uppercase tracking-widest">Companies by Type</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3 p-5">
            {byType.map((item: any) => (
              <div key={item.type} className="rounded-full border px-3 py-1.5 text-sm">
                <span className="font-semibold capitalize">{item.type}</span>
                <span className="ml-2 font-mono text-muted-foreground">{item.count}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
