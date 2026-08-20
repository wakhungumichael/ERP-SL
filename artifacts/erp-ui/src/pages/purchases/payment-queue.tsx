import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Clock3, ShieldAlert, Wallet } from 'lucide-react';

import { useAuth } from '@/context/use-auth';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ProcessFlow } from '@/components/workflow/process-flow';

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, '') ?? '';

type PaymentQueueItem = {
  id: number;
  bill_id: number;
  bill_number: string;
  supplier_name: string;
  amount: number;
  due_date: string | null;
  status: string;
  payment_reference?: string | null;
  notes?: string;
};

const STATUS_TONE: Record<string, string> = {
  pending: 'bg-slate-100 text-slate-700',
  ready: 'bg-emerald-100 text-emerald-700',
  scheduled: 'bg-blue-100 text-blue-700',
  paid: 'bg-teal-100 text-teal-700',
  blocked: 'bg-rose-100 text-rose-700',
};

function fmt(value: number) {
  return 'KES ' + Number(value ?? 0).toLocaleString('en-KE', { minimumFractionDigits: 2 });
}

export default function PaymentQueuePage() {
  const { token } = useAuth();
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState('10');

  const params = new URLSearchParams();
  if (statusFilter && statusFilter !== 'all') params.set('status', statusFilter);

  const query = useQuery({
    queryKey: ['purchase-payment-queue', token, statusFilter],
    enabled: !!token,
    queryFn: async () => {
      const qs = params.toString() ? `?${params.toString()}` : '';
      const r = await fetch(BASE_URL + `/api/purchases/payment-queue/${qs}`, {
        headers: { Authorization: 'Token ' + token },
      });
      if (!r.ok) throw new Error('Failed to load payment queue');
      return r.json();
    },
  });

  const rows: PaymentQueueItem[] = query.data?.results ?? [];
  const totalPages = Math.max(1, Math.ceil(rows.length / Number(pageSize)));
  const visibleRows = rows.slice((page - 1) * Number(pageSize), page * Number(pageSize));

  const stats = useMemo(() => ({
    total: rows.length,
    ready: rows.filter((item) => item.status === 'ready').length,
    blocked: rows.filter((item) => item.status === 'blocked').length,
    scheduled: rows.filter((item) => item.status === 'scheduled').length,
    paid: rows.filter((item) => item.status === 'paid').length,
    readyAmount: rows.filter((item) => item.status === 'ready').reduce((sum, item) => sum + Number(item.amount ?? 0), 0),
  }), [rows]);

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Payment queue</h1>
          <p className="text-sm text-muted-foreground">
            See which supplier bills are ready to pay, which ones are blocked, and what finance should act on next.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/procurement/bills">Open supplier bills</Link>
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {[
          { label: 'All items', value: stats.total },
          { label: 'Ready to pay', value: stats.ready },
          { label: 'Blocked', value: stats.blocked },
          { label: 'Scheduled', value: stats.scheduled },
          { label: 'Paid', value: stats.paid },
        ].map((item) => (
          <Card key={item.label}>
            <CardHeader className="pb-1 pt-3 px-4">
              <CardTitle className="text-xs font-medium text-muted-foreground">{item.label}</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              <p className="text-2xl font-semibold">{item.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <ProcessFlow
        title="Payables to payment flow"
        description="Matched and approved supplier bills should become ready payments, then move into scheduling and settlement without leaving this control path."
        stages={[
          { label: 'Supplier Bill', active: rows.length > 0 },
          { label: '3-Way Match', active: rows.some((item) => item.status !== 'pending') },
          { label: 'Approval', active: rows.some((item) => ['ready', 'scheduled', 'paid', 'blocked'].includes(item.status)) },
          { label: 'Ready To Pay', active: stats.ready > 0, current: stats.ready > 0 },
          { label: 'Scheduled', active: stats.scheduled > 0 },
          { label: 'Paid', active: stats.paid > 0 },
        ]}
        actions={[
          {
            label: 'Review supplier bills',
            href: '/procurement/bills',
            icon: <Wallet className="h-4 w-4 text-sky-600" />,
            helper: 'Fix matching or approval issues directly from the bill workspace.',
            tone: 'default',
          },
          {
            label: 'Blocked items',
            href: '/procurement/bills',
            icon: <ShieldAlert className="h-4 w-4 text-rose-600" />,
            helper: 'Blocked payments usually need bill corrections or matching decisions.',
            tone: 'warning',
          },
          {
            label: 'Payment methods',
            href: '/payments/methods',
            icon: <Clock3 className="h-4 w-4 text-emerald-600" />,
            helper: 'Keep payment channels and settlement options ready for treasury work.',
            tone: 'success',
          },
        ]}
      />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Payment worklist</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">Ready amount: {fmt(stats.readyAmount)}</p>
          </div>
          <div className="flex items-end gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Status</Label>
              <Select value={statusFilter || 'all'} onValueChange={(value) => { setStatusFilter(value === 'all' ? '' : value); setPage(1); }}>
                <SelectTrigger className="w-40 h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All items</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="ready">Ready</SelectItem>
                  <SelectItem value="blocked">Blocked</SelectItem>
                  <SelectItem value="scheduled">Scheduled</SelectItem>
                  <SelectItem value="paid">Paid</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {query.isLoading ? (
            <div className="text-sm text-muted-foreground">Loading payment queue…</div>
          ) : rows.length === 0 ? (
            <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
              No payment items found for the selected filter.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Bill</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Due date</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleRows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.bill_number || `Bill #${row.bill_id}`}</TableCell>
                    <TableCell>{row.supplier_name}</TableCell>
                    <TableCell>{row.due_date || '—'}</TableCell>
                    <TableCell className="text-right">{fmt(Number(row.amount ?? 0))}</TableCell>
                    <TableCell>
                      <Badge className={STATUS_TONE[row.status] ?? 'bg-slate-100 text-slate-700'}>
                        {row.status.charAt(0).toUpperCase() + row.status.slice(1)}
                      </Badge>
                    </TableCell>
                    <TableCell>{row.payment_reference || 'Not assigned'}</TableCell>
                    <TableCell className="text-right">
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/procurement/bills?open_bill=${row.bill_id}`}>
                          Open bill
                          <ArrowRight className="ml-2 h-4 w-4" />
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {rows.length > 0 ? (
            <div className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-muted-foreground">
                Showing page {page} of {totalPages} with {rows.length} payment items
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm text-muted-foreground">Rows</span>
                <Select value={pageSize} onValueChange={(value) => { setPageSize(value); setPage(1); }}>
                  <SelectTrigger className="w-24">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="10">10</SelectItem>
                    <SelectItem value="25">25</SelectItem>
                    <SelectItem value="50">50</SelectItem>
                  </SelectContent>
                </Select>
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next</Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
