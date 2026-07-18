import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TrendingUp, FileText, AlertCircle, CheckCircle2, Clock } from 'lucide-react';

function useAccountingDashboard() {
  return useQuery({
    queryKey: ['accounting-dashboard'],
    queryFn: async () => {
      const base = (window as any).__ERP_BASE_URL__ ?? '';
      const token = localStorage.getItem('sl-erp-token');
      const res = await fetch(`${base}/api/accounting/dashboard/`, {
        headers: { Authorization: `Token ${token}` },
      });
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    staleTime: 60_000,
  });
}

const STATUS_BADGE: Record<string, string> = {
  draft:  'bg-gray-100 text-gray-700 border-gray-300 dark:bg-gray-800 dark:text-gray-400',
  issued: 'bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-900/30 dark:text-blue-400',
  paid:   'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-900/30 dark:text-emerald-400',
};

export default function AccountingDashboard() {
  const { data, isLoading, error } = useAccountingDashboard();

  if (isLoading) {
    return (
      <div className="p-12 text-center font-mono text-sm text-muted-foreground animate-pulse">
        Loading accounting data…
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-12 text-center text-destructive font-mono text-sm">
        Failed to load accounting data. Ensure the accounting module is active.
      </div>
    );
  }

  const tx = data?.transactions ?? {};
  const inv = data?.invoices ?? {};
  const recent: any[] = data?.recent_invoices ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b pb-4">
        <h1 className="text-3xl font-bold tracking-tight">Accounting Overview</h1>
        <div className="text-xs font-mono text-muted-foreground">
          Month from {data?.period?.month_start ?? '—'}
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Revenue (Month)</span>
              <TrendingUp className="h-4 w-4 text-emerald-500" />
            </div>
            <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400 font-mono">
              KES {(tx.total_charge_this_month ?? 0).toLocaleString()}
            </div>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Total Invoiced</span>
              <FileText className="h-4 w-4 text-blue-500" />
            </div>
            <div className="text-2xl font-black font-mono">KES {(inv.total_invoiced ?? 0).toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Collected</span>
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            </div>
            <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400 font-mono">
              KES {(inv.total_paid ?? 0).toLocaleString()}
            </div>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Outstanding</span>
              <AlertCircle className="h-4 w-4 text-orange-500" />
            </div>
            <div className="text-2xl font-black text-orange-600 dark:text-orange-400 font-mono">
              KES {(inv.outstanding ?? 0).toLocaleString()}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Invoice + transaction split */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="shadow-sm">
          <CardHeader className="bg-muted/20 border-b py-3">
            <CardTitle className="text-sm font-bold uppercase tracking-widest">Invoice Status</CardTitle>
          </CardHeader>
          <CardContent className="p-5 space-y-3">
            {[
              { label: 'Draft',  value: inv.draft  ?? 0, icon: <Clock className="h-4 w-4 text-gray-400" /> },
              { label: 'Issued', value: inv.issued ?? 0, icon: <FileText className="h-4 w-4 text-blue-500" /> },
              { label: 'Paid',   value: inv.paid   ?? 0, icon: <CheckCircle2 className="h-4 w-4 text-emerald-500" /> },
            ].map(row => (
              <div key={row.label} className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-medium">{row.icon}{row.label}</div>
                <span className="font-mono font-bold">{row.value}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="bg-muted/20 border-b py-3">
            <CardTitle className="text-sm font-bold uppercase tracking-widest">Transaction Summary</CardTitle>
          </CardHeader>
          <CardContent className="p-5 space-y-3">
            {[
              { label: 'Completed',          value: tx.completed           ?? 0 },
              { label: 'Pending',            value: tx.pending             ?? 0 },
              { label: 'Uninvoiced (done)',   value: tx.uninvoiced_completed ?? 0 },
            ].map(row => (
              <div key={row.label} className="flex items-center justify-between">
                <span className="text-sm font-medium">{row.label}</span>
                <span className="font-mono font-bold">{row.value}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Recent invoices */}
      {recent.length > 0 && (
        <Card className="shadow-sm">
          <CardHeader className="bg-muted/20 border-b py-3">
            <CardTitle className="text-sm font-bold uppercase tracking-widest">Recent Invoices</CardTitle>
          </CardHeader>
          <div className="overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead>Invoice #</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                  <TableHead className="text-right">Amount (KES)</TableHead>
                  <TableHead>Due</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recent.map((inv: any) => (
                  <TableRow key={inv.id} className="hover:bg-muted/30">
                    <TableCell className="font-mono font-bold">{inv.invoice_number}</TableCell>
                    <TableCell className="font-medium">{inv.customer_name}</TableCell>
                    <TableCell className="text-center">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold tracking-widest uppercase border ${STATUS_BADGE[inv.status] ?? 'bg-secondary border-border'}`}>
                        {inv.status}
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-mono">{(inv.total_amount ?? 0).toLocaleString()}</TableCell>
                    <TableCell className="text-xs text-muted-foreground font-mono">{inv.due_date ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}
    </div>
  );
}
