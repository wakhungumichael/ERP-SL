import { useGetWeighbridgeDashboard, getGetWeighbridgeDashboardQueryKey } from '@workspace/api-client-react';
import { Link } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowRight, CreditCard, FileText, TimerReset, Truck } from 'lucide-react';

export default function WeighbridgeOverview() {
  const { data, isLoading } = useGetWeighbridgeDashboard(
    undefined,
    { query: { queryKey: getGetWeighbridgeDashboardQueryKey() } }
  );

  if (isLoading) return <div className="p-12 text-center text-muted-foreground font-mono animate-pulse">Initializing weighbridge overview…</div>;

  const metrics = [
    {
      title: 'All Transactions',
      value: data?.totals?.all_transactions || 0,
      accent: 'border-l-primary',
      valueClassName: 'text-foreground',
      icon: <Truck className="h-5 w-5 text-primary" />,
    },
    {
      title: 'Pending Transactions',
      value: data?.totals?.pending_transactions || 0,
      accent: 'border-l-amber-500',
      valueClassName: 'text-amber-600 dark:text-amber-400',
      icon: <TimerReset className="h-5 w-5 text-amber-500" />,
    },
    {
      title: 'Pending Payments',
      value: data?.totals?.pending_payments || 0,
      accent: 'border-l-orange-500',
      valueClassName: 'text-orange-600 dark:text-orange-400',
      icon: <CreditCard className="h-5 w-5 text-orange-500" />,
    },
  ];

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 border-b pb-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Weighbridge Overview</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Dedicated operational dashboard for daily throughput, statuses, and recent bridge activity.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/weighbridge/transactions" className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors hover:bg-muted">
            Transactions
          </Link>
          <Link href="/weighbridge/reports" className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:opacity-95">
            Reports
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,1fr)_380px] xl:items-start">
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 xl:items-start">
            {metrics.map((metric) => (
              <Card key={metric.title} className={`border-l-4 ${metric.accent} self-start shadow-sm`}>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{metric.title}</CardTitle>
                  {metric.icon}
                </CardHeader>
                <CardContent className="pt-0">
                  <div className={`text-3xl font-black font-mono tracking-tighter ${metric.valueClassName}`}>
                    {metric.value}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card className="shadow-sm border-border self-start">
            <CardHeader className="border-b bg-muted/20">
              <CardTitle className="text-sm font-bold uppercase tracking-widest flex items-center gap-2">
                <ArrowRight className="h-4 w-4 text-primary" />
                Quick Links
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 p-5">
              <p className="text-sm text-muted-foreground">
                Jump quickly to the tasks your weighbridge team uses most during the day.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Link href="/weighbridge/weighment-entry" className="rounded-lg border bg-background p-4 transition-colors hover:bg-muted/30">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold">Weighment Entry</div>
                      <div className="mt-1 text-xs text-muted-foreground">Capture first weight, second weight, and vehicle flow.</div>
                    </div>
                    <ArrowRight className="h-4 w-4 text-primary" />
                  </div>
                </Link>
                <Link href="/weighbridge/transactions" className="rounded-lg border bg-background p-4 transition-colors hover:bg-muted/30">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold">Transactions</div>
                      <div className="mt-1 text-xs text-muted-foreground">Review, search, and manage recent weighbridge records.</div>
                    </div>
                    <ArrowRight className="h-4 w-4 text-primary" />
                  </div>
                </Link>
                <Link href="/weighbridge/live" className="rounded-lg border bg-background p-4 transition-colors hover:bg-muted/30">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold">Live Weight</div>
                      <div className="mt-1 text-xs text-muted-foreground">Watch current bridge readings and live activity.</div>
                    </div>
                    <ArrowRight className="h-4 w-4 text-primary" />
                  </div>
                </Link>
                <Link href="/weighbridge/reports" className="rounded-lg border bg-background p-4 transition-colors hover:bg-muted/30">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold">Reports</div>
                      <div className="mt-1 text-xs text-muted-foreground">Open summaries, audits, revenue, and operational reports.</div>
                    </div>
                    <ArrowRight className="h-4 w-4 text-primary" />
                  </div>
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="shadow-sm border-border self-start">
          <CardHeader className="border-b bg-muted/20">
            <CardTitle className="text-sm font-bold uppercase tracking-widest text-foreground flex items-center gap-2">
              <Truck className="h-4 w-4 text-primary" />
              Recent Weighbridge Activity
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {data?.recent_transactions?.length ? (
              <div className="divide-y divide-border">
                {data.recent_transactions.slice(0, 5).map((t) => (
                  <Link
                    key={t.id}
                    href={`/weighbridge/transactions/${t.id}`}
                    className="block space-y-2 px-4 py-3 transition-colors hover:bg-muted/30"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate font-mono text-base font-bold">{t.vehicle_plate}</div>
                        <div className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                          {t.customer_name} • {t.item_name || 'Unknown'}
                        </div>
                      </div>
                      <span className="rounded border bg-secondary px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-secondary-foreground">
                        {t.status}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                      <span>{t.actor_display_name || t.actor_username || t.operator || 'System'}</span>
                      <span className="font-mono text-sm font-bold text-foreground">
                        {t.net_weight ? `${t.net_weight} kg` : 'Net weight pending'}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="py-12 text-center text-sm font-mono text-muted-foreground">No recent activity detected.</div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
