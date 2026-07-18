import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Building2, Users, Truck, TrendingUp, CheckCircle2,
  Phone, Mail, Calendar, MessageSquare, ArrowRight,
} from 'lucide-react';

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
  new:         'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  contacted:   'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  proposal:    'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
  negotiation: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
  won:         'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
  lost:        'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
};

const ACTIVITY_ICONS: Record<string, React.ReactNode> = {
  call:    <Phone className="h-3.5 w-3.5" />,
  email:   <Mail className="h-3.5 w-3.5" />,
  meeting: <Calendar className="h-3.5 w-3.5" />,
  note:    <MessageSquare className="h-3.5 w-3.5" />,
  task:    <CheckCircle2 className="h-3.5 w-3.5" />,
};

export default function CRMDashboard() {
  const { data, isLoading } = useCRMDashboard();

  if (isLoading) {
    return <div className="p-12 text-center font-mono text-sm text-muted-foreground animate-pulse">Loading overview…</div>;
  }

  const s = data?.summary ?? {};
  const stages: any[] = data?.pipeline_stages ?? [];
  const followUps: any[] = data?.recent_follow_ups ?? [];
  const byType: any[] = data?.companies_by_type ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b pb-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Relationships</h1>
          <p className="text-sm text-muted-foreground mt-1">Your companies, people, and sales pipeline at a glance</p>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        {[
          { label: 'Companies',     value: s.companies,            icon: <Building2 className="h-4 w-4 text-blue-500" />,    href: '/crm/companies' },
          { label: 'People',        value: s.people,               icon: <Users className="h-4 w-4 text-indigo-500" />,      href: '/crm/people' },
          { label: 'Suppliers',     value: s.suppliers,            icon: <Truck className="h-4 w-4 text-amber-500" />,       href: '/crm/suppliers' },
          { label: 'Open Deals',    value: s.open_opportunities,   icon: <TrendingUp className="h-4 w-4 text-primary" />,    href: '/crm/opportunities' },
          { label: 'Won This Month',value: s.won_this_month,       icon: <CheckCircle2 className="h-4 w-4 text-emerald-500" />, href: '/crm/opportunities?stage=won' },
          { label: 'Pipeline Value',value: `KES ${(s.pipeline_value ?? 0).toLocaleString()}`, icon: <TrendingUp className="h-4 w-4 text-emerald-500" />, href: '/crm/opportunities', wide: true },
        ].map(({ label, value, icon, href }) => (
          <Link key={label} href={href}>
            <Card className="cursor-pointer hover:shadow-md transition-shadow shadow-sm">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">{icon}</div>
                <div className="text-xl font-black">{value ?? 0}</div>
                <div className="text-xs font-medium text-muted-foreground mt-1">{label}</div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pipeline funnel */}
        <Card className="shadow-sm">
          <CardHeader className="bg-muted/20 border-b py-3 flex-row items-center justify-between">
            <CardTitle className="text-sm font-bold uppercase tracking-widest">Sales Pipeline</CardTitle>
            <Link href="/crm/opportunities" className="text-xs text-primary hover:underline flex items-center gap-1">
              View all <ArrowRight className="h-3 w-3" />
            </Link>
          </CardHeader>
          <CardContent className="p-5 space-y-2">
            {stages.map((stage: any) => (
              <div key={stage.stage} className="flex items-center gap-3">
                <span className={`w-24 px-2 py-0.5 rounded text-[10px] font-bold tracking-wide uppercase text-center ${STAGE_COLORS[stage.stage] ?? 'bg-secondary'}`}>
                  {stage.label}
                </span>
                <div className="flex-1 bg-muted rounded-full h-2 overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all"
                    style={{ width: `${Math.min(100, (stage.count / Math.max(1, s.companies ?? 1)) * 200)}%` }}
                  />
                </div>
                <span className="font-mono font-bold text-sm w-8 text-right">{stage.count}</span>
                {stage.value > 0 && (
                  <span className="text-xs text-muted-foreground font-mono w-28 text-right">
                    KES {stage.value.toLocaleString()}
                  </span>
                )}
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Recent follow-ups */}
        <Card className="shadow-sm">
          <CardHeader className="bg-muted/20 border-b py-3 flex-row items-center justify-between">
            <CardTitle className="text-sm font-bold uppercase tracking-widest">Recent Follow-ups</CardTitle>
            <Link href="/crm/follow-ups" className="text-xs text-primary hover:underline flex items-center gap-1">
              View all <ArrowRight className="h-3 w-3" />
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            {followUps.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">No recent follow-ups logged.</div>
            ) : (
              <ul className="divide-y divide-border">
                {followUps.slice(0, 7).map((a: any) => (
                  <li key={a.id} className="flex items-start gap-3 px-5 py-3">
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                      {ACTIVITY_ICONS[a.type] ?? <MessageSquare className="h-3.5 w-3.5" />}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{a.summary}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {a.contact_name || a.organisation_name || a.lead_title || '—'}
                        {a.created_by_name ? ` · ${a.created_by_name}` : ''}
                      </p>
                    </div>
                    <span className="text-[10px] text-muted-foreground font-mono shrink-0">
                      {new Date(a.date).toLocaleDateString()}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Company type breakdown */}
      {byType.length > 0 && (
        <Card className="shadow-sm">
          <CardHeader className="bg-muted/20 border-b py-3">
            <CardTitle className="text-sm font-bold uppercase tracking-widest">Companies by Type</CardTitle>
          </CardHeader>
          <CardContent className="p-5 flex flex-wrap gap-4">
            {byType.map((t: any) => (
              <div key={t.type} className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground capitalize">{t.type}</span>
                <span className="font-mono font-black">{t.count}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
