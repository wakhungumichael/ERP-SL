import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/context/use-auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  BarChart3, TrendingUp, Scale, FileText, DollarSign,
  AlertCircle, CheckCircle2, Clock, Users, Truck,
} from 'lucide-react';

function useReportData(token: string | null) {
  return useQuery({
    queryKey: ['report-summary'],
    queryFn: async () => {
      const headers = { Authorization: `Token ${token}` };
      const [txRes, dashRes] = await Promise.all([
        fetch('/api/commercial-weighbridge/transactions/?page_size=5&page=1', { headers }),
        fetch('/api/commercial-weighbridge/dashboard/', { headers }),
      ]);
      const txData = txRes.ok ? await txRes.json() : { count: 0, results: [] };
      const dash   = dashRes.ok ? await dashRes.json() : null;
      return { txData, dash };
    },
    enabled: !!token,
    staleTime: 60_000,
  });
}

interface StatCardProps {
  title: string;
  value: string | number;
  sub?: string;
  icon: React.ReactNode;
  color?: string;
}

function StatCard({ title, value, sub, icon, color = 'text-primary' }: StatCardProps) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">{title}</p>
            <p className={`text-2xl font-bold font-mono ${color}`}>{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
          </div>
          <div className={`p-2 rounded-lg bg-muted/60 ${color}`}>{icon}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function fmt(dt?: string | null) {
  if (!dt) return '—';
  return new Date(dt).toLocaleString('en-KE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
}

export default function ReportsDashboard() {
  const { token } = useAuth();
  const { data, isLoading } = useReportData(token);

  const dash = data?.dash;
  const txData = data?.txData;

  const totalTx     = txData?.count ?? 0;
  const recentRows  = txData?.results ?? [];
  const pendingTx   = dash?.pending_transactions ?? '—';
  const completedTx = dash?.completed_transactions ?? '—';
  const todayTx     = dash?.today_transactions ?? '—';
  const totalRev    = dash?.total_revenue != null ? `KES ${Number(dash.total_revenue).toLocaleString('en-KE', { minimumFractionDigits: 2 })}` : '—';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="border-b pb-4">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <BarChart3 className="h-6 w-6 text-primary" />
          Reports & Analytics
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">Operational summary across all weighbridge activity</p>
      </div>

      {/* Stats grid */}
      {isLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}><CardContent className="p-5"><div className="h-16 bg-muted/60 rounded animate-pulse" /></CardContent></Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard title="Total Transactions" value={totalTx.toLocaleString()} icon={<Scale className="h-5 w-5" />} />
          <StatCard title="Today's Transactions" value={todayTx} icon={<TrendingUp className="h-5 w-5" />} color="text-blue-600" />
          <StatCard title="Pending" value={pendingTx} icon={<Clock className="h-5 w-5" />} color="text-amber-600" />
          <StatCard title="Total Revenue" value={totalRev} icon={<DollarSign className="h-5 w-5" />} color="text-emerald-600" />
        </div>
      )}

      {/* Recent transactions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                <FileText className="h-4 w-4" /> Recent Transactions
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {recentRows.length === 0 ? (
                <p className="text-center py-8 text-sm text-muted-foreground font-mono">No transactions found</p>
              ) : (
                <div className="divide-y divide-border">
                  {recentRows.map((t: any) => (
                    <div key={t.id} className="flex items-center gap-3 px-5 py-3 hover:bg-muted/30 transition-colors">
                      <span className="font-mono font-bold text-xs text-primary w-14">#{String(t.id).padStart(5, '0')}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-xs">{t.vehicle_plate}</span>
                          <span className="text-xs text-muted-foreground truncate">{t.customer_name}</span>
                        </div>
                        <div className="text-[10px] text-muted-foreground">{fmt(t.created_at)}</div>
                      </div>
                      <div className="text-right shrink-0">
                        {t.net_weight && (
                          <div className="text-xs font-mono font-bold text-emerald-600">{Number(t.net_weight).toLocaleString()} kg</div>
                        )}
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                          t.status === 'Completed'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : 'bg-amber-50 text-amber-700 border-amber-200'
                        }`}>
                          {t.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Summary panel */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4" /> Status Breakdown
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {[
                { label: 'Completed', value: completedTx, color: 'bg-emerald-500' },
                { label: 'Pending',   value: pendingTx,   color: 'bg-amber-500' },
              ].map(row => (
                <div key={row.label} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className={`h-2 w-2 rounded-full ${row.color}`} />
                    <span className="text-xs font-medium">{row.label}</span>
                  </div>
                  <span className="font-mono font-bold text-sm">{row.value ?? '—'}</span>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                <AlertCircle className="h-4 w-4" /> Quick Links
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {[
                { label: 'Export CSV',         href: '/weighbridge/transactions', badge: 'Transactions' },
                { label: 'Invoice Overview',   href: '/payments/invoices',        badge: 'Finance' },
                { label: 'Accounting Summary', href: '/accounting/dashboard',     badge: 'Accounting' },
              ].map(link => (
                <a key={link.label} href={link.href}
                  className="flex items-center justify-between p-2 rounded-md hover:bg-muted/60 transition-colors group">
                  <span className="text-xs font-medium group-hover:text-primary">{link.label}</span>
                  <Badge variant="secondary" className="text-[10px]">{link.badge}</Badge>
                </a>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                <Users className="h-4 w-4" /> Module Status
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {[
                { label: 'Weighbridge',   status: 'Live',       color: 'text-emerald-600' },
                { label: 'CRM',           status: 'Live',       color: 'text-emerald-600' },
                { label: 'Payments',      status: 'Live',       color: 'text-emerald-600' },
                { label: 'HR & Payroll',  status: 'Planned',    color: 'text-amber-600' },
                { label: 'Procurement',   status: 'Planned',    color: 'text-amber-600' },
              ].map(m => (
                <div key={m.label} className="flex items-center justify-between">
                  <span className="text-xs">{m.label}</span>
                  <span className={`text-[10px] font-bold ${m.color}`}>{m.status}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
