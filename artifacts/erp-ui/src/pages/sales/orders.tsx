/* Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu. */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation } from 'wouter';
import { useAuth } from '@/context/use-auth';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { FileSpreadsheet, Receipt, ArrowRight, Plus, X } from 'lucide-react';

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

function responseItems(payload: any, preferredKey?: string): any[] {
  if (Array.isArray(payload)) return payload;
  if (preferredKey && Array.isArray(payload?.[preferredKey])) return payload[preferredKey];
  if (Array.isArray(payload?.results)) return payload.results;
  return [];
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
  const [createOpen, setCreateOpen] = useState(false);

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
        <Button onClick={() => setCreateOpen(true)}><Plus className="mr-2 h-4 w-4" /> New Sales Order</Button>
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
      <NewSalesOrderDialog open={createOpen} onOpenChange={setCreateOpen} token={token} onSaved={() => { setCreateOpen(false); void refetch(); }} />
    </div>
  );
}

type OrderLine = { product: number | null; description: string; quantity: number; unit_price: number; tax_rate: number; discount_amount: number; sort_order: number };

function NewSalesOrderDialog({ open, onOpenChange, token, onSaved }: { open: boolean; onOpenChange: (open: boolean) => void; token: string | null; onSaved: () => void }) {
  const { toast } = useToast();
  const [customer, setCustomer] = useState('');
  const [delivery, setDelivery] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<OrderLine[]>([{ product: null, description: '', quantity: 1, unit_price: 0, tax_rate: 0, discount_amount: 0, sort_order: 0 }]);
  const [saving, setSaving] = useState(false);
  const customersQuery = useQuery({
    queryKey: ['sales-order-customers', token],
    enabled: !!token && open,
    queryFn: async () => {
      const response = await fetch('/api/sales/customers/?page_size=100', { headers: { Authorization: `Token ${token}` } });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(parseErrorMessage(body, 'Customers could not be loaded. Check that your role can view Sales customers.'));
      return body;
    },
  });
  const productsQuery = useQuery({
    queryKey: ['sales-order-products', token],
    enabled: !!token && open,
    queryFn: async () => {
      const response = await fetch('/api/sales/products/?is_active=true&page_size=100', { headers: { Authorization: `Token ${token}` } });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(parseErrorMessage(body, 'Products and services could not be loaded.'));
      return body;
    },
  });
  const customers = responseItems(customersQuery.data, 'customers');
  const products = responseItems(productsQuery.data, 'products');
  const updateLine = (index: number, values: Partial<OrderLine>) => setLines(current => current.map((line, lineIndex) => lineIndex === index ? { ...line, ...values } : line));
  const chooseProduct = (index: number, value: string) => {
    const product = products.find(item => String(item.id) === value);
    updateLine(index, { product: product?.id ?? null, description: product?.description || product?.name || '', unit_price: Number(product?.unit_price ?? 0), tax_rate: Number(product?.tax_rate ?? 0) });
  };
  const save = async () => {
    if (!customer || lines.every(line => !line.description.trim())) return;
    setSaving(true);
    try {
      const response = await fetch('/api/sales/sales-orders/', { method: 'POST', headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ customer: Number(customer), expected_delivery_date: delivery || null, status: 'draft', notes, line_items: lines.filter(line => line.description.trim()) }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(parseErrorMessage(body, 'Sales order could not be created.'));
      toast({ title: `Sales order ${body.order_number} created` });
      onSaved();
    } catch (error: any) { toast({ title: 'Could not create sales order', description: error.message, variant: 'destructive' }); }
    finally { setSaving(false); }
  };
  const loadingReferences = customersQuery.isLoading || productsQuery.isLoading;
  const referenceError = customersQuery.error || productsQuery.error;
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto"><DialogHeader><DialogTitle>New Sales Order</DialogTitle></DialogHeader><div className="space-y-4">
    {referenceError ? <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"><p className="font-medium">The order form could not load its options.</p><p className="mt-1">{(referenceError as Error).message}</p><Button type="button" size="sm" variant="outline" className="mt-3" onClick={() => { void customersQuery.refetch(); void productsQuery.refetch(); }}>Try again</Button></div> : null}
    <div className="grid gap-3 sm:grid-cols-2"><div><Label>Customer</Label><Select value={customer} onValueChange={setCustomer} disabled={loadingReferences || customersQuery.isError}><SelectTrigger><SelectValue placeholder={customersQuery.isLoading ? "Loading customers…" : customers.length ? "Select customer" : "No customers available"} /></SelectTrigger><SelectContent>{customers.map(item => <SelectItem key={item.id} value={String(item.id)}>{item.name}</SelectItem>)}</SelectContent></Select>{!customersQuery.isLoading && !customersQuery.isError && customers.length === 0 ? <p className="mt-1 text-xs text-muted-foreground">Add a Sales customer before creating an order.</p> : null}</div><div><Label>Expected delivery</Label><Input type="date" value={delivery} onChange={event => setDelivery(event.target.value)} /></div></div>
    <div className="space-y-2"><div className="flex justify-between"><Label>Products, services and descriptions</Label><Button size="sm" variant="outline" onClick={() => setLines(current => [...current, { product: null, description: '', quantity: 1, unit_price: 0, tax_rate: 0, discount_amount: 0, sort_order: current.length }])}>Add row</Button></div>{lines.map((line, index) => <div className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1.2fr_2fr_.6fr_.8fr_auto]" key={index}><Select value={line.product ? String(line.product) : '__custom__'} onValueChange={value => chooseProduct(index, value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__custom__">Custom line</SelectItem>{products.map(item => <SelectItem key={item.id} value={String(item.id)}>{item.name}</SelectItem>)}</SelectContent></Select><Input placeholder="Editable description" value={line.description} onChange={event => updateLine(index, { description: event.target.value })} /><Input type="number" min="0.001" step="0.001" value={line.quantity} onChange={event => updateLine(index, { quantity: Number(event.target.value) })} /><Input type="number" min="0" step="0.01" value={line.unit_price} onChange={event => updateLine(index, { unit_price: Number(event.target.value) })} /><Button size="icon" variant="ghost" disabled={lines.length === 1} onClick={() => setLines(current => current.filter((_, lineIndex) => lineIndex !== index))}><X className="h-4 w-4" /></Button></div>)}</div>
    <div><Label>Notes</Label><Textarea value={notes} onChange={event => setNotes(event.target.value)} /></div>
  </div><DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button disabled={saving || loadingReferences || !!referenceError || !customer || lines.every(line => !line.description.trim())} onClick={() => void save()}>{saving ? 'Creating…' : 'Create sales order'}</Button></DialogFooter></DialogContent></Dialog>;
}
