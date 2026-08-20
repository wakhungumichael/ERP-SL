import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation } from 'wouter';
import { useAuth } from '@/context/use-auth';
import { useToast } from '@/hooks/use-toast';
import { ProcessFlow } from '@/components/workflow/process-flow';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { FileSpreadsheet, Receipt, ArrowRight, Boxes, CheckCircle2, TrendingUp } from 'lucide-react';

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, '') ?? '';
const fmt = (v: number) => 'KES ' + Number(v ?? 0).toLocaleString('en-KE', { minimumFractionDigits: 2 });

const statusColors: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  confirmed: 'bg-blue-100 text-blue-700',
  fulfilled: 'bg-emerald-100 text-emerald-700',
  invoiced: 'bg-violet-100 text-violet-700',
  cancelled: 'bg-red-100 text-red-700',
};

interface SalesOrder {
  id: number;
  order_number: string;
  customer_name: string;
  customer_display?: string;
  order_date: string;
  expected_delivery_date: string | null;
  total: number;
  status: string;
  converted_to_invoice: number | null;
}

interface SalesOrderResponse {
  count: number;
  page: number;
  page_size: number;
  total_pages: number;
  next: number | null;
  previous: number | null;
  results: SalesOrder[];
}

function parseErrorMessage(body: any, fallback: string) {
  if (!body) return fallback;
  if (typeof body === 'string') return body;
  if (body.error) return body.error;
  if (body.detail) return body.detail;
  const first = Object.values(body)[0];
  if (Array.isArray(first) && first.length) return String(first[0]);
  return fallback;
}

export default function SalesOrdersPage() {
  const { token } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState('10');

  const params = new URLSearchParams();
  if (statusFilter) params.set('status', statusFilter);
  if (search.trim()) params.set('search', search.trim());
  if (dateFrom) params.set('date_from', dateFrom);
  if (dateTo) params.set('date_to', dateTo);
  params.set('page', String(page));
  params.set('page_size', pageSize);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['sales-orders', token, statusFilter, search, dateFrom, dateTo, page, pageSize],
    enabled: !!token,
    queryFn: async () => {
      const r = await fetch(BASE_URL + '/api/sales/sales-orders/?' + params.toString(), {
        headers: { Authorization: 'Token ' + token },
      });
      if (!r.ok) throw new Error('Failed to fetch sales orders');
      return r.json() as Promise<SalesOrderResponse>;
    },
  });

  const orders = data?.results ?? [];
  const totalCount = data?.count ?? 0;
  const totalPages = data?.total_pages ?? 1;

  async function handleConvert(id: number) {
    try {
      const r = await fetch(BASE_URL + '/api/sales/sales-orders/' + id + '/convert/', {
        method: 'POST',
        headers: { Authorization: 'Token ' + token },
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(parseErrorMessage(body, 'Failed to convert sales order'));
      toast({ title: 'Sales order converted to invoice' });
      refetch();
    } catch (error: any) {
      toast({ title: 'Error converting sales order', description: error.message, variant: 'destructive' });
    }
  }

  const counts = useMemo(() => ({
    total: totalCount,
    confirmed: orders.filter((o) => o.status === 'confirmed').length,
    fulfilled: orders.filter((o) => o.status === 'fulfilled').length,
    invoiced: orders.filter((o) => o.status === 'invoiced').length,
  }), [orders, totalCount]);

  function applyQuickStatus(value: string) {
    setStatusFilter(value);
    setPage(1);
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Sales Orders</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Track confirmed customer orders, monitor fulfillment, and create invoices at the right time.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: 'Total', value: counts.total },
          { label: 'Confirmed', value: counts.confirmed },
          { label: 'Fulfilled', value: counts.fulfilled },
          { label: 'Invoiced', value: counts.invoiced },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="pt-4">
              <p className="text-2xl font-bold">{s.value}</p>
              <p className="text-sm text-muted-foreground">{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <ProcessFlow
        title="Order Flow"
        description="Move customer work from quote to order, fulfillment, invoice, and collection in one clear flow."
        stages={[
          { label: 'Estimate', active: true },
          { label: 'Sales Order', active: true, current: true },
          { label: 'Fulfillment', active: counts.fulfilled > 0 },
          { label: 'Invoice', active: counts.invoiced > 0 },
          { label: 'Collection' },
          { label: 'Accounting' },
        ]}
        actions={[
          {
            label: 'Quotes',
            href: '/sales/estimates',
            icon: <TrendingUp className="h-4 w-4 text-violet-600" />,
            helper: 'Orders should start from approved customer quotes.',
            tone: 'default',
          },
          {
            label: 'Fulfillment',
            href: '/inventory/overview',
            icon: <Boxes className="h-4 w-4 text-sky-600" />,
            helper: 'Reserve stock and dispatch customer orders from inventory.',
            tone: 'warning',
          },
          {
            label: 'Invoices',
            href: '/payments/invoices',
            icon: <CheckCircle2 className="h-4 w-4 text-emerald-600" />,
            helper: 'Turn completed work into billing and receivables.',
            tone: 'success',
          },
        ]}
      />

      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-1 flex-wrap gap-3">
          <Input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search order number, customer, or notes"
            className="w-full md:w-72"
          />
          <Select value={statusFilter || '__all__'} onValueChange={(value) => applyQuickStatus(value === '__all__' ? '' : value)}>
            <SelectTrigger className="w-full md:w-44">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All statuses</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="confirmed">Confirmed</SelectItem>
              <SelectItem value="fulfilled">Fulfilled</SelectItem>
              <SelectItem value="invoiced">Invoiced</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>
          <Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} className="w-full md:w-44" />
          <Input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} className="w-full md:w-44" />
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
        </div>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : orders.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-20 text-muted-foreground">
          <FileSpreadsheet className="h-10 w-10 opacity-40" />
          <p>No sales orders found</p>
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order #</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Order Date</TableHead>
                <TableHead>Expected Delivery</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Next Step</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((o) => (
                <TableRow key={o.id}>
                  <TableCell className="font-medium">{o.order_number}</TableCell>
                  <TableCell>{o.customer_display || o.customer_name || 'Walk-in customer'}</TableCell>
                  <TableCell>{o.order_date}</TableCell>
                  <TableCell>{o.expected_delivery_date || '—'}</TableCell>
                  <TableCell>{fmt(o.total)}</TableCell>
                  <TableCell>
                    <Badge className={statusColors[o.status] ?? 'bg-gray-100 text-gray-700'}>
                      {o.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Link
                      href={
                        o.status === 'draft'
                          ? '/sales/estimates'
                          : o.status === 'confirmed'
                            ? '/inventory/overview'
                            : o.status === 'fulfilled'
                              ? '/payments/invoices'
                              : '/sales/orders'
                      }
                      className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
                    >
                      {o.status === 'draft'
                        ? 'Review quote'
                        : o.status === 'confirmed'
                          ? 'Fulfill order'
                          : o.status === 'fulfilled'
                            ? 'Create invoice'
                            : o.status === 'invoiced'
                              ? 'View receivable'
                              : 'Review order'}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-2">
                      {o.converted_to_invoice ? (
                        <Button size="sm" variant="outline" onClick={() => navigate(`/payments/invoices/${o.converted_to_invoice}`)}>
                          <Receipt className="mr-1 h-4 w-4" /> Open Invoice
                        </Button>
                      ) : o.status !== 'invoiced' ? (
                        <Button size="sm" variant="outline" onClick={() => handleConvert(o.id)}>
                          <ArrowRight className="mr-1 h-4 w-4" /> Create Invoice
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">Already invoiced</span>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-muted-foreground">
          Showing page {data?.page ?? 1} of {totalPages} with {totalCount} orders
          {isFetching && !isLoading ? ' • refreshing…' : ''}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={(data?.previous ?? null) === null} onClick={() => setPage((prev) => Math.max(prev - 1, 1))}>
            Previous
          </Button>
          <Button variant="outline" size="sm" disabled={(data?.next ?? null) === null} onClick={() => setPage((prev) => prev + 1)}>
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
