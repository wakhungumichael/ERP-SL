import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'wouter';
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TrendingUp, FileText, AlertCircle, CheckCircle2, Clock, RefreshCw, WandSparkles, ArrowRight, ReceiptText, WalletCards, Upload, CircleDollarSign } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

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
  posted: 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-900/30 dark:text-emerald-400',
  reversed: 'bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-900/30 dark:text-orange-400',
};

const CHART_COLORS = ['#10b981', '#2563eb', '#f97316', '#7c3aed', '#94a3b8', '#ec4899'];

function formatKes(value: unknown) {
  return `KES ${Number(value ?? 0).toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;
}

export default function AccountingDashboard() {
  const { toast } = useToast();
  const { data, isLoading, error } = useAccountingDashboard();
  const [bootstrapping, setBootstrapping] = useState(false);
  const [resyncing, setResyncing] = useState(false);

  async function postAction(path: string, setter: (value: boolean) => void, title: string) {
    setter(true);
    try {
      const base = (window as any).__ERP_BASE_URL__ ?? '';
      const token = localStorage.getItem('sl-erp-token');
      const res = await fetch(`${base}${path}`, {
        method: 'POST',
        headers: { Authorization: `Token ${token}` },
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error || 'Request failed');
      toast({ title, description: payload?.message || 'Completed successfully.' });
      window.location.reload();
    } catch (error: any) {
      toast({ title: 'Action failed', description: error.message, variant: 'destructive' });
    } finally {
      setter(false);
    }
  }

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
  const bills = data?.bills ?? {};
  const journals = data?.journals ?? {};
  const analytics = data?.analytics ?? {};
  const monthlyPerformance: any[] = analytics.monthly_performance ?? [];
  const expenseCategories: any[] = analytics.expense_categories ?? [];
  const recentEntries: any[] = analytics.recent_journal_entries ?? [];
  const currentMonth = monthlyPerformance[monthlyPerformance.length - 1] ?? {};
  const profit = Number(currentMonth.net ?? 0);
  const currentMonthRange = `date_from=${data?.period?.month_start ?? ''}&date_to=${data?.period?.today ?? ''}`;
  const cashFlow = [
    { label: 'Cash In', amount: Number(journals.cash_in ?? 0), color: '#10b981' },
    { label: 'Cash Out', amount: Number(journals.cash_out ?? 0), color: '#2563eb' },
    { label: 'Net Cash Flow', amount: Number(journals.cash_in ?? 0) - Number(journals.cash_out ?? 0), color: '#f59e0b' },
  ];
  const kpis = [
    { label: 'Revenue (Month)', value: tx.total_charge_this_month, hint: 'Posted this month', href: `/finance/reports?tab=income-statement&drill=revenue&${currentMonthRange}`, icon: <TrendingUp className="h-5 w-5" />, tone: 'emerald' },
    { label: 'Total Invoiced', value: inv.total_invoiced, hint: 'Issued invoices', href: '/finance/receivables?status=issued', icon: <FileText className="h-5 w-5" />, tone: 'blue' },
    { label: 'Collected', value: inv.total_paid, hint: 'Paid invoices', href: '/finance/receivables?status=paid', icon: <CheckCircle2 className="h-5 w-5" />, tone: 'emerald' },
    { label: 'Outstanding', value: inv.outstanding, hint: 'Overdue invoices', href: '/finance/receivables?status=overdue', icon: <AlertCircle className="h-5 w-5" />, tone: 'orange' },
    { label: 'Profit (Month)', value: profit, hint: 'Revenue less expenses', href: `/finance/reports?tab=income-statement&drill=profit&${currentMonthRange}`, icon: <CircleDollarSign className="h-5 w-5" />, tone: 'violet' },
  ];

  return (
    <div className="w-full space-y-5 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Accounting Overview</h1>
          <p className="mt-1 text-sm text-muted-foreground">Real-time summary of your accounting performance and key financial insights.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => postAction('/api/accounting/setup/bootstrap/', setBootstrapping, 'Accounting structure prepared')} disabled={bootstrapping}>
            <WandSparkles className="mr-1 h-4 w-4" /> {bootstrapping ? 'Preparing…' : 'Prepare Setup'}
          </Button>
          <Button variant="outline" size="sm" onClick={() => postAction('/api/accounting/resync/', setResyncing, 'Accounting postings refreshed')} disabled={resyncing}>
            <RefreshCw className="mr-1 h-4 w-4" /> {resyncing ? 'Re-syncing…' : 'Re-sync Postings'}
          </Button>
          <div className="rounded-md border bg-card px-3 py-2 text-xs font-mono text-muted-foreground">Month from {data?.period?.month_start ?? '—'}</div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {kpis.map((kpi) => <Link key={kpi.label} href={kpi.href} className="group"><Card className="h-full border shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"><CardContent className="flex items-center gap-3 p-4"><div className={`rounded-full p-3 ${kpi.tone === 'emerald' ? 'bg-emerald-100 text-emerald-600' : kpi.tone === 'blue' ? 'bg-blue-100 text-blue-600' : kpi.tone === 'orange' ? 'bg-orange-100 text-orange-600' : 'bg-violet-100 text-violet-600'}`}>{kpi.icon}</div><div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{kpi.label}</p><p className="mt-1 truncate font-mono text-xl font-black">{formatKes(kpi.value)}</p><p className="mt-1 text-[10px] text-muted-foreground">{kpi.hint}</p></div></CardContent></Card></Link>)}
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between border-b py-3"><CardTitle className="text-xs font-bold uppercase tracking-wide">Revenue Trend</CardTitle><Link href="/finance/reports?tab=income-statement" className="rounded border px-2 py-1 text-[10px] font-semibold text-muted-foreground hover:border-primary hover:text-primary">Last 6 Months</Link></CardHeader>
          <CardContent className="h-64 p-3">
            {monthlyPerformance.length ? <ResponsiveContainer width="100%" height="100%"><LineChart data={monthlyPerformance} onClick={(state: any) => { const point = state?.activePayload?.[0]?.payload; const period = point?.date_from && point?.date_to ? `&date_from=${point.date_from}&date_to=${point.date_to}` : ''; window.location.href = `/finance/reports?tab=income-statement${period}`; }}><CartesianGrid vertical={false} stroke="#e5e7eb" /><XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} /><YAxis tickLine={false} axisLine={false} tick={{ fontSize: 10 }} tickFormatter={(value) => `KES ${Number(value) / 1000}K`} /><Tooltip formatter={(value: number) => formatKes(value)} /><Line type="monotone" dataKey="revenue" name="Revenue" stroke="#10b981" strokeWidth={3} dot={{ fill: '#10b981', r: 4 }} activeDot={{ r: 6 }} /></LineChart></ResponsiveContainer> : <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No posted revenue for this period.</div>}
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between border-b py-3"><CardTitle className="text-xs font-bold uppercase tracking-wide">Expenses by Category (Month)</CardTitle><Link href={`/finance/reports?tab=income-statement&drill=expenses&${currentMonthRange}`} className="rounded border px-2 py-1 text-[10px] font-semibold text-muted-foreground hover:border-primary hover:text-primary">View report</Link></CardHeader>
          <CardContent className="flex h-64 items-center gap-2 p-3">
            {expenseCategories.length ? <><ResponsiveContainer width="52%" height="100%"><PieChart><Pie data={expenseCategories} dataKey="amount" nameKey="name" innerRadius="55%" outerRadius="82%" paddingAngle={2} onClick={(segment: any) => { window.location.href = `/finance/reports?tab=income-statement&drill=expense-category&search=${encodeURIComponent(segment?.name ?? '')}&${currentMonthRange}`; }}>{expenseCategories.map((_: any, index: number) => <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}</Pie><Tooltip formatter={(value: number) => formatKes(value)} /></PieChart></ResponsiveContainer><div className="min-w-0 flex-1 space-y-2">{expenseCategories.map((category: any, index: number) => <Link key={category.name} href={`/finance/reports?tab=income-statement&drill=expense-category&search=${encodeURIComponent(category.name)}&${currentMonthRange}`} className="flex items-center gap-2 text-[11px] hover:text-primary"><i className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }} /><span className="truncate">{category.name}</span><span className="ml-auto font-mono text-[10px]">{formatKes(category.amount)}</span></Link>)}</div></> : <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground"><ReceiptText className="h-8 w-8 opacity-40" />No posted expenses this month.</div>}
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between border-b py-3"><CardTitle className="text-xs font-bold uppercase tracking-wide">Cash Flow Summary (Month)</CardTitle><Link href="/finance/transactions?status=posted" className="rounded border px-2 py-1 text-[10px] font-semibold text-muted-foreground hover:border-primary hover:text-primary">This Month</Link></CardHeader>
          <CardContent className="h-64 p-3"><ResponsiveContainer width="100%" height="100%"><BarChart data={cashFlow} onClick={(state: any) => { const source = state?.activeLabel === 'Cash In' ? 'payment' : state?.activeLabel === 'Cash Out' ? 'bill' : ''; window.location.href = `/finance/transactions?status=posted${source ? `&source_type=${source}` : ''}`; }}><CartesianGrid vertical={false} stroke="#e5e7eb" /><XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} /><YAxis tickLine={false} axisLine={false} tick={{ fontSize: 10 }} tickFormatter={(value) => `KES ${Number(value) / 1000}K`} /><Tooltip formatter={(value: number) => formatKes(value)} /><Bar dataKey="amount" radius={[4, 4, 0, 0]}>{cashFlow.map((item) => <Cell key={item.label} fill={item.color} />)}</Bar></BarChart></ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Link href="/finance/receivables?status=issued" className="group"><Card className="h-full shadow-sm transition-all group-hover:border-primary/40 group-hover:shadow-md">
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
        </Card></Link>

        <Link href="/weighbridge/transactions?status=Completed" className="group"><Card className="h-full shadow-sm transition-all group-hover:border-primary/40 group-hover:shadow-md">
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
        </Card></Link>
        <Link href="/finance/payables?status=approved" className="group"><Card className="h-full shadow-sm transition-all group-hover:border-primary/40 group-hover:shadow-md">
          <CardHeader className="bg-muted/20 border-b py-3">
            <CardTitle className="text-sm font-bold uppercase tracking-widest">Payables</CardTitle>
          </CardHeader>
          <CardContent className="p-5 space-y-3">
            {[
              { label: 'Approved Bills', value: bills.approved ?? 0 },
              { label: 'Paid Bills', value: bills.paid ?? 0 },
              { label: 'Outstanding', value: `KES ${(bills.outstanding ?? 0).toLocaleString()}` },
            ].map(row => (
              <div key={row.label} className="flex items-center justify-between">
                <span className="text-sm font-medium">{row.label}</span>
                <span className="font-mono font-bold">{row.value}</span>
              </div>
            ))}
          </CardContent>
        </Card></Link>

        <Link href="/finance/transactions?status=posted" className="group"><Card className="h-full shadow-sm transition-all group-hover:border-primary/40 group-hover:shadow-md">
          <CardHeader className="bg-muted/20 border-b py-3">
            <CardTitle className="text-sm font-bold uppercase tracking-widest">Posting Health</CardTitle>
          </CardHeader>
          <CardContent className="p-5 space-y-3">
            {[
              { label: 'Posted Entries', value: journals.posted_entries ?? 0 },
              { label: 'Draft Entries', value: journals.draft_entries ?? 0 },
              { label: 'Sales Postings', value: `KES ${(journals.sales_postings ?? 0).toLocaleString()}` },
              { label: 'Cash In', value: `KES ${(journals.cash_in ?? 0).toLocaleString()}` },
            ].map(row => (
              <div key={row.label} className="flex items-center justify-between">
                <span className="text-sm font-medium">{row.label}</span>
                <span className="font-mono font-bold">{row.value}</span>
              </div>
            ))}
          </CardContent>
        </Card></Link>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <Card className="shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between border-b py-3"><CardTitle className="text-xs font-bold uppercase tracking-wide">Recent Transactions</CardTitle><Link href="/finance/transactions" className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-primary">View all transactions <ArrowRight className="h-3.5 w-3.5" /></Link></CardHeader>
        <div className="overflow-x-auto"><Table className="min-w-[760px]"><TableHeader><TableRow className="bg-muted/40"><TableHead>Date</TableHead><TableHead>Type</TableHead><TableHead>Reference</TableHead><TableHead>Source</TableHead><TableHead>Memo</TableHead><TableHead className="text-right">Debit (KES)</TableHead><TableHead className="text-right">Credit (KES)</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>{recentEntries.length ? recentEntries.map((entry) => <TableRow key={entry.id} className="cursor-pointer hover:bg-muted/30"><TableCell className="text-xs">{new Date(entry.entry_date).toLocaleDateString('en-KE')}</TableCell><TableCell className="capitalize">{entry.source_type}</TableCell><TableCell><Link href={`/finance/transactions/${entry.id}`} className="font-mono text-xs font-bold text-primary hover:underline">{entry.entry_number}</Link></TableCell><TableCell>{entry.journal_name}</TableCell><TableCell className="max-w-[180px] truncate text-muted-foreground">{entry.memo || '—'}</TableCell><TableCell className="text-right font-mono text-xs">{Number(entry.debit_total).toLocaleString()}</TableCell><TableCell className="text-right font-mono text-xs">{Number(entry.credit_total).toLocaleString()}</TableCell><TableCell><span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${STATUS_BADGE[entry.status] ?? 'bg-muted text-muted-foreground'}`}>{entry.status}</span></TableCell></TableRow>) : <TableRow><TableCell colSpan={8} className="py-12 text-center text-sm text-muted-foreground">No posted journal entries yet.</TableCell></TableRow>}</TableBody></Table></div>
      </Card>
      <Card className="shadow-sm"><CardHeader className="border-b py-3"><CardTitle className="text-xs font-bold uppercase tracking-wide">Quick Actions</CardTitle></CardHeader><CardContent className="space-y-1 p-3">{[{ label: 'Create Invoice', href: '/sales/invoices', icon: FileText }, { label: 'Record Payment', href: '/finance/receivables', icon: WalletCards }, { label: 'Record Expense', href: '/purchases/bills?create=1', icon: ReceiptText }, { label: 'Create Journal Entry', href: '/finance/transactions', icon: FileText }, { label: 'Import Transactions', href: '/finance/transactions', icon: Upload }].map((action) => { const Icon = action.icon; return <Link key={action.label} href={action.href} className="flex items-center justify-between rounded-md border px-3 py-2.5 text-sm font-medium transition-colors hover:border-primary/40 hover:bg-muted"><span className="flex items-center gap-2"><Icon className="h-4 w-4 text-muted-foreground" />{action.label}</span><ArrowRight className="h-4 w-4 text-muted-foreground" /></Link>; })}</CardContent></Card>
      </div>
    </div>
  );
}
