import { useGetWeighbridgeDashboard, getGetWeighbridgeDashboardQueryKey } from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Activity, Scale, CreditCard, Clock, Truck } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from 'recharts';

export default function Dashboard() {
  const { data, isLoading } = useGetWeighbridgeDashboard(
    undefined,
    { query: { queryKey: getGetWeighbridgeDashboardQueryKey() } }
  );

  if (isLoading) return <div className="p-12 text-center text-muted-foreground font-mono animate-pulse">Initializing Operations Center...</div>;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between border-b pb-4">
        <h1 className="text-3xl font-bold tracking-tight">Operations Dashboard</h1>
        <div className="flex items-center gap-2 text-sm font-mono text-muted-foreground">
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
          </span>
          SYSTEM ONLINE
        </div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card className="border-l-4 border-l-primary shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Trans. Today</CardTitle>
            <Activity className="h-5 w-5 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-black font-mono tracking-tighter">{data?.totals?.transactions_today || 0}</div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-emerald-500 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Net Weight (KG)</CardTitle>
            <Scale className="h-5 w-5 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-black font-mono tracking-tighter text-emerald-600 dark:text-emerald-400">
              {(data?.totals?.net_weight_today || 0).toLocaleString()}
            </div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-orange-500 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Pending Payments</CardTitle>
            <CreditCard className="h-5 w-5 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-black font-mono tracking-tighter text-orange-600 dark:text-orange-400">
              {data?.totals?.pending_payments || 0}
            </div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-blue-500 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Monthly Trans.</CardTitle>
            <Clock className="h-5 w-5 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-black font-mono tracking-tighter text-blue-600 dark:text-blue-400">
              {data?.totals?.transactions_this_month || 0}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <Card className="lg:col-span-2 shadow-sm border-border">
          <CardHeader className="border-b bg-muted/20">
            <CardTitle className="text-sm font-bold uppercase tracking-widest text-foreground flex items-center gap-2">
              <Truck className="h-4 w-4 text-primary" />
              Recent Weighbridge Activity
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {data?.recent_transactions?.length ? (
              <div className="divide-y divide-border">
                {data.recent_transactions.map(t => (
                  <div key={t.id} className="flex items-center justify-between p-4 hover:bg-muted/30 transition-colors">
                    <div className="flex flex-col gap-1">
                      <div className="font-bold font-mono text-lg">{t.vehicle_plate}</div>
                      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        {t.customer_name} • {t.item_name || 'UNKNOWN'}
                      </div>
                    </div>
                    <div className="text-right flex flex-col gap-1">
                      <div className="font-bold font-mono text-lg">{t.net_weight ? `${t.net_weight} kg` : 'IN TRANSIT'}</div>
                      <div>
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold tracking-widest uppercase bg-secondary text-secondary-foreground border">
                          {t.status}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12 text-sm font-mono text-muted-foreground">No recent activity detected.</div>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-sm border-border">
          <CardHeader className="border-b bg-muted/20">
            <CardTitle className="text-sm font-bold uppercase tracking-widest flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              Status Diagnostics
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6 h-80">
            {data?.status_breakdown?.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.status_breakdown} layout="vertical" margin={{ top: 0, right: 0, left: 30, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="hsl(var(--border))" />
                  <XAxis type="number" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis dataKey="status" type="category" fontSize={11} tickLine={false} axisLine={false} width={80} />
                  <Tooltip cursor={{fill: 'hsl(var(--muted))'}} contentStyle={{ borderRadius: '8px', border: '1px solid hsl(var(--border))', fontWeight: 'bold', fontSize: '12px', textTransform: 'uppercase' }} />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]} barSize={24}>
                    {data.status_breakdown.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={index % 2 === 0 ? 'hsl(var(--primary))' : 'hsl(var(--sidebar))'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-sm font-mono text-muted-foreground">Insufficient data.</div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}