import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
import { useAuth } from '@/context/use-auth';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, '') ?? '';
const fmt = (v: number) => 'KES ' + Number(v ?? 0).toLocaleString('en-KE', { minimumFractionDigits: 2 });
const TODAY = new Date().toISOString().slice(0, 10);

type LineItem = { description: string; quantity: number; unit_price: number; tax_rate: number };
type BillLineItem = LineItem & { id?: number; line_total?: number };
type Bill = {
  id: number;
  bill_number?: string;
  supplier_name: string;
  purchase_order_reference?: string;
  goods_receipt_number?: string;
  reference?: string;
  issue_date: string;
  due_date: string;
  total_amount?: number;
  match_status?: string;
  payment_queue_status?: string | null;
  status: string;
  notes?: string;
  subtotal?: number;
  tax_total?: number;
  total?: number;
  line_items?: BillLineItem[];
};

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  received: 'bg-blue-100 text-blue-700',
  approved: 'bg-emerald-100 text-emerald-700',
  paid: 'bg-teal-100 text-teal-700',
  overdue: 'bg-red-100 text-red-700',
};

const emptyLine = (defaultTaxRate = 0): LineItem => ({ description: '', quantity: 1, unit_price: 0, tax_rate: defaultTaxRate });

const emptyForm = () => ({
  supplier_name: '',
  purchase_order: '',
  goods_receipt: '',
  reference: '',
  issue_date: '',
  due_date: '',
  notes: '',
});

export default function BillsPage() {
  const { token, user } = useAuth();
  const { toast } = useToast();
  const tenantId = (user as any)?.tenant_id;

  const [filterStatus, setFilterStatus] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState('10');
  const [prefillHandled, setPrefillHandled] = useState(false);
  const [openBillHandled, setOpenBillHandled] = useState(false);

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [lines, setLines] = useState<LineItem[]>([emptyLine()]);
  const [saving, setSaving] = useState(false);
  const [selectedBill, setSelectedBill] = useState<Bill | null>(null);
  const [detailForm, setDetailForm] = useState(emptyForm());
  const [detailLines, setDetailLines] = useState<LineItem[]>([emptyLine()]);
  const [detailSaving, setDetailSaving] = useState(false);

  const { data: tenantSettingsData } = useQuery({
    queryKey: ['purchase-bill-tenant-settings', tenantId, token],
    enabled: !!tenantId && !!token,
    queryFn: async () => {
      const r = await fetch(BASE_URL + `/api/platform/tenants/${tenantId}/settings/`, {
        headers: { Authorization: 'Token ' + token },
      });
      if (!r.ok) throw new Error('settings fetch failed');
      return r.json();
    },
  });

  const tenantSettings = tenantSettingsData?.data ?? tenantSettingsData ?? {};
  const defaultTaxRate = Number(tenantSettings.default_tax_rate ?? 0);
  const defaultTaxName = tenantSettings.default_tax_name || 'Tax';

  const { data: poData } = useQuery({
    queryKey: ['purchase-bill-po-options', token],
    enabled: !!token,
    queryFn: async () => {
      const r = await fetch(BASE_URL + '/api/procurement/orders/', {
        headers: { Authorization: 'Token ' + token },
      });
      if (!r.ok) throw new Error('po fetch failed');
      return r.json();
    },
  });

  const { data: grnData } = useQuery({
    queryKey: ['purchase-bill-grn-options', token],
    enabled: !!token,
    queryFn: async () => {
      const r = await fetch(BASE_URL + '/api/procurement/receipts/', {
        headers: { Authorization: 'Token ' + token },
      });
      if (!r.ok) throw new Error('grn fetch failed');
      return r.json();
    },
  });

  const poOptions = poData?.results ?? [];
  const grnOptions = grnData?.results ?? [];

  const params = new URLSearchParams();
  if (filterStatus && filterStatus !== 'all') params.set('status', filterStatus);
  if (dateFrom) params.set('date_from', dateFrom);
  if (dateTo) params.set('date_to', dateTo);
  const qs = params.toString() ? '?' + params.toString() : '';

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['bills', token, filterStatus, dateFrom, dateTo],
    enabled: !!token,
    queryFn: async () => {
      const r = await fetch(BASE_URL + '/api/purchases/bills/' + qs, {
        headers: { Authorization: 'Token ' + token },
      });
      if (!r.ok) throw new Error('fetch failed');
      return r.json();
    },
  });

  const bills: Bill[] = Array.isArray(data) ? data : (data?.bills ?? data?.results ?? []);
  const totalPages = Math.max(1, Math.ceil(bills.length / Number(pageSize)));
  const visibleBills = bills.slice((page - 1) * Number(pageSize), page * Number(pageSize));

  useEffect(() => {
    if (!selectedBill) return;
    const fresh = bills.find((bill) => bill.id === selectedBill.id);
    if (fresh) {
      setSelectedBill(fresh);
    }
  }, [bills, selectedBill]);

  useEffect(() => {
    if (typeof window === 'undefined' || prefillHandled || !token) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('create') !== '1') {
      setPrefillHandled(true);
      return;
    }
    const receiptId = params.get('receipt_id');
    const purchaseOrderId = params.get('purchase_order_id');
    if (!receiptId) return;
    const receipt = grnOptions.find((item: any) => String(item.id) === receiptId);
    if (!receipt) return;
    const purchaseOrder = poOptions.find((item: any) => String(item.id) === (purchaseOrderId || String(receipt.purchase_order)));
    const poItems = purchaseOrder?.items ?? [];
    setForm({
      supplier_name: purchaseOrder?.supplier_name ?? '',
      purchase_order: purchaseOrder ? String(purchaseOrder.id) : purchaseOrderId ?? '',
      goods_receipt: String(receipt.id),
      reference: '',
      issue_date: receipt.received_date || TODAY,
      due_date: '',
      notes: `Auto-linked from goods receipt ${receipt.receipt_number}.`,
    });
    setLines(
      receipt.lines?.length
        ? receipt.lines.map((line: any) => {
            const matchedPoLine = poItems.find((poLine: any) => poLine.description === line.description);
            return {
              description: line.description ?? '',
              quantity: Number(line.accepted_quantity ?? line.received_quantity ?? 0),
              unit_price: Number(matchedPoLine?.unit_price ?? line.unit_price ?? 0),
              tax_rate: defaultTaxRate,
            };
          })
        : [emptyLine(defaultTaxRate)],
    );
    setOpen(true);
    setPrefillHandled(true);
    window.history.replaceState({}, '', window.location.pathname);
  }, [defaultTaxRate, grnOptions, poOptions, prefillHandled, token]);

  useEffect(() => {
    if (typeof window === 'undefined' || openBillHandled) return;
    const params = new URLSearchParams(window.location.search);
    const billId = params.get('open_bill');
    if (!billId) {
      setOpenBillHandled(true);
      return;
    }
    const matchedBill = bills.find((item) => String(item.id) === billId);
    if (!matchedBill) return;
    openBillWorkspace(matchedBill);
    setOpenBillHandled(true);
    window.history.replaceState({}, '', window.location.pathname);
  }, [bills, openBillHandled]);

  // Stats
  const total = bills.length;
  const draftCount = bills.filter((b) => b.status === 'draft').length;
  const approvedCount = bills.filter((b) => b.status === 'approved').length;
  const paidCount = bills.filter((b) => b.status === 'paid').length;
  const overdueCount = bills.filter((b) => b.status === 'overdue').length;

  // Line item helpers
  const updateLine = (idx: number, field: keyof LineItem, value: string | number) => {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, [field]: value } : l)));
  };
  const addLine = () => setLines((prev) => [...prev, emptyLine(defaultTaxRate)]);
  const removeLine = (idx: number) => setLines((prev) => prev.filter((_, i) => i !== idx));

  const lineTotal = (l: LineItem) => l.quantity * l.unit_price;
  const lineTax = (l: LineItem) => lineTotal(l) * (l.tax_rate / 100);
  const subtotal = lines.reduce((s, l) => s + lineTotal(l), 0);
  const totalTax = lines.reduce((s, l) => s + lineTax(l), 0);
  const grandTotal = subtotal + totalTax;

  const detailSubtotal = useMemo(
    () => detailLines.reduce((sum, line) => sum + line.quantity * line.unit_price, 0),
    [detailLines],
  );
  const detailTaxTotal = useMemo(
    () => detailLines.reduce((sum, line) => sum + (line.quantity * line.unit_price * (line.tax_rate / 100)), 0),
    [detailLines],
  );
  const detailGrandTotal = detailSubtotal + detailTaxTotal;

  function openCreate() {
    setForm(emptyForm());
    setLines([emptyLine(defaultTaxRate)]);
    setPage(1);
    setOpen(true);
  }

  function openBillWorkspace(bill: Bill) {
    setSelectedBill(bill);
    setDetailForm({
      supplier_name: bill.supplier_name ?? '',
      purchase_order: bill.purchase_order_reference ?? 'none',
      goods_receipt: bill.goods_receipt_number ?? 'none',
      reference: bill.reference ?? '',
      issue_date: bill.issue_date ?? '',
      due_date: bill.due_date ?? '',
      notes: bill.notes ?? '',
    });
    setDetailLines(
      bill.line_items?.length
        ? bill.line_items.map((line) => ({
            description: line.description ?? '',
            quantity: Number(line.quantity ?? 0),
            unit_price: Number(line.unit_price ?? 0),
            tax_rate: Number(line.tax_rate ?? defaultTaxRate),
          }))
        : [emptyLine(defaultTaxRate)],
    );
  }

  async function handleCreate() {
    if (!form.supplier_name) {
      toast({ title: 'Supplier name is required', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const r = await fetch(BASE_URL + '/api/purchases/bills/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Token ' + token },
        body: JSON.stringify({
          ...form,
          purchase_order: (form as any).purchase_order ? Number((form as any).purchase_order) : null,
          goods_receipt: (form as any).goods_receipt ? Number((form as any).goods_receipt) : null,
          line_items: lines,
        }),
      });
      if (!r.ok) throw new Error('Failed');
      toast({ title: 'Bill created successfully' });
      refetch();
      setOpen(false);
      setPage(1);
    } catch {
      toast({ title: 'Error creating bill', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  async function handlePatch(id: number, status: string) {
    try {
      const r = await fetch(BASE_URL + `/api/purchases/bills/${id}/`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: 'Token ' + token },
        body: JSON.stringify({ status }),
      });
      if (!r.ok) throw new Error('Failed');
      toast({ title: `Bill marked as ${status}` });
      refetch();
    } catch {
      toast({ title: 'Error updating bill', variant: 'destructive' });
    }
  }

  async function handleThreeWayMatch(id: number) {
    try {
      const r = await fetch(BASE_URL + `/api/purchases/bills/${id}/three-way-match/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Token ' + token },
        body: JSON.stringify({ tolerance_percent: 2 }),
      });
      if (!r.ok) throw new Error('Failed');
      const result = await r.json();
      toast({ title: `3-way match ${result?.match_result?.status ?? 'processed'}` });
      refetch();
    } catch {
      toast({ title: 'Error running 3-way match', variant: 'destructive' });
    }
  }

  async function handlePreparePayment(id: number) {
    try {
      const r = await fetch(BASE_URL + `/api/purchases/bills/${id}/prepare-payment/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Token ' + token },
      });
      if (!r.ok) throw new Error('Failed');
      const result = await r.json();
      toast({ title: `Payment queue status: ${result?.payment_queue_status ?? 'prepared'}` });
      refetch();
    } catch {
      toast({ title: 'Error preparing payment', variant: 'destructive' });
    }
  }

  async function handleUpdateSelected() {
    if (!selectedBill) return;
    if (!detailForm.supplier_name) {
      toast({ title: 'Supplier name is required', variant: 'destructive' });
      return;
    }
    setDetailSaving(true);
    try {
      const poId = detailForm.purchase_order === 'none'
        ? null
        : poOptions.find((po: any) => po.reference === detailForm.purchase_order)?.id;
      const grnId = detailForm.goods_receipt === 'none'
        ? null
        : grnOptions.find((grn: any) => grn.receipt_number === detailForm.goods_receipt)?.id;
      const r = await fetch(BASE_URL + `/api/purchases/bills/${selectedBill.id}/`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: 'Token ' + token },
        body: JSON.stringify({
          supplier_name: detailForm.supplier_name,
          reference: detailForm.reference || null,
          issue_date: detailForm.issue_date || null,
          due_date: detailForm.due_date || null,
          notes: detailForm.notes || '',
          status: selectedBill.status,
          purchase_order: poId ?? null,
          goods_receipt: grnId ?? null,
          line_items: detailLines,
        }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        throw new Error(body?.error || body?.detail || 'Failed to update bill');
      }
      setSelectedBill(body);
      setDetailForm({
        supplier_name: body.supplier_name ?? '',
        purchase_order: body.purchase_order_reference ?? 'none',
        goods_receipt: body.goods_receipt_number ?? 'none',
        reference: body.reference ?? '',
        issue_date: body.issue_date ?? '',
        due_date: body.due_date ?? '',
        notes: body.notes ?? '',
      });
      setDetailLines(
        body.line_items?.length
          ? body.line_items.map((line: any) => ({
              description: line.description ?? '',
              quantity: Number(line.quantity ?? 0),
              unit_price: Number(line.unit_price ?? 0),
              tax_rate: Number(line.tax_rate ?? defaultTaxRate),
            }))
          : [emptyLine(defaultTaxRate)],
      );
      toast({ title: 'Bill updated' });
      refetch();
    } catch (error: any) {
      toast({ title: 'Error updating bill', description: error.message, variant: 'destructive' });
    } finally {
      setDetailSaving(false);
    }
  }

  async function handleDetailStatus(status: string) {
    if (!selectedBill) return;
    try {
      const r = await fetch(BASE_URL + `/api/purchases/bills/${selectedBill.id}/`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: 'Token ' + token },
        body: JSON.stringify({ status }),
      });
      if (!r.ok) throw new Error('Failed');
      const updated = await r.json();
      setSelectedBill(updated);
      toast({ title: `Bill marked as ${status}` });
      refetch();
    } catch {
      toast({ title: 'Error updating bill', variant: 'destructive' });
    }
  }

  const nextAction = (() => {
    if (!selectedBill) return null;
    if ((selectedBill.match_status ?? 'pending') !== 'matched') {
      return { label: 'Run 3-way match', helper: 'Validate the bill against the purchase order and goods receipt before payment.' };
    }
    if (selectedBill.status === 'draft' || selectedBill.status === 'received') {
      return { label: 'Approve bill', helper: 'Move the supplier bill into approved status so it can enter payment control.' };
    }
    if (selectedBill.status === 'approved' && !selectedBill.payment_queue_status) {
      return { label: 'Prepare payment', helper: 'Queue the approved bill for treasury or payables processing.' };
    }
    if (selectedBill.status === 'paid') {
      return { label: 'Review postings', helper: 'The bill is closed. Use finance reports and payables reconciliation for audit follow-up.' };
    }
    return { label: 'Monitor payables workflow', helper: 'Track matching, approvals, and payment queue progress from this workspace.' };
  })();

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Supplier bills</h1>
          <p className="text-sm text-muted-foreground">
            Review received supplier invoices, confirm matching, and move them into payment.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline">
            <Link href="/procurement/payment-queue">Open payment queue</Link>
          </Button>
          <Button onClick={openCreate}>New bill</Button>
        </div>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          { label: 'Total Bills', value: total },
          { label: 'Draft', value: draftCount },
          { label: 'Approved', value: approvedCount },
          { label: 'Paid', value: paidCount },
          { label: 'Overdue', value: overdueCount },
        ].map((s) => (
          <Card key={s.label}>
            <CardHeader className="pb-1 pt-3 px-4">
              <CardTitle className="text-xs font-medium text-muted-foreground">{s.label}</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              <p className="text-2xl font-semibold">{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="space-y-1">
          <Label className="text-xs">Status</Label>
          <Select value={filterStatus || 'all'} onValueChange={(value) => { setFilterStatus(value === 'all' ? '' : value); setPage(1); }}>
            <SelectTrigger className="w-36 h-8 text-sm">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="received">Received</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="paid">Paid</SelectItem>
              <SelectItem value="overdue">Overdue</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">From date</Label>
          <Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} className="h-8 text-sm w-36" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">To date</Label>
          <Input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} className="h-8 text-sm w-36" />
        </div>
        {(filterStatus || dateFrom || dateTo) && (
          <Button variant="ghost" size="sm" onClick={() => { setFilterStatus(''); setDateFrom(''); setDateTo(''); }}>
            Clear
          </Button>
        )}
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">Loading…</div>
          ) : bills.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 14H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v6a2 2 0 01-2 2h-4m-6 4l3 3m0 0l3-3m-3 3V14" />
              </svg>
              <span className="text-sm">No bills found</span>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Bill #</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>PO / receipt</TableHead>
                  <TableHead>Issue date</TableHead>
                  <TableHead>Due date</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Match</TableHead>
                  <TableHead>Payment</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleBills.map((b) => (
                  <TableRow key={b.id} className="cursor-pointer hover:bg-muted/50" onClick={() => openBillWorkspace(b)}>
                    <TableCell className="font-mono text-sm">
                      <button className="text-left font-medium text-primary hover:underline" onClick={(event) => { event.stopPropagation(); openBillWorkspace(b); }}>
                        {b.bill_number ?? `#${b.id}`}
                      </button>
                    </TableCell>
                    <TableCell>{b.supplier_name}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      <div>{b.purchase_order_reference ?? 'No PO'}</div>
                      <div>{b.goods_receipt_number ?? 'No GRN'}</div>
                    </TableCell>
                    <TableCell>{b.issue_date}</TableCell>
                    <TableCell>{b.due_date}</TableCell>
                    <TableCell className="text-right">{fmt((b as any).total ?? (b as any).total_amount ?? 0)}</TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[b.status] ?? 'bg-gray-100 text-gray-700'}`}>
                        {b.status.charAt(0).toUpperCase() + b.status.slice(1)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-slate-100 text-slate-700">
                        {b.match_status ?? 'pending'}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-slate-100 text-slate-700">
                        {b.payment_queue_status ?? 'not queued'}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1 flex-wrap">
                        {(b.status === 'draft' || b.status === 'received') && (
                          <Button size="sm" variant="outline" onClick={(event) => { event.stopPropagation(); handlePatch(b.id, 'approved'); }}>
                            Approve
                          </Button>
                        )}
                        {b.status === 'approved' && (
                          <Button size="sm" variant="outline" onClick={(event) => { event.stopPropagation(); handlePatch(b.id, 'paid'); }}>
                            Mark Paid
                          </Button>
                        )}
                        <Button size="sm" variant="outline" onClick={(event) => { event.stopPropagation(); handleThreeWayMatch(b.id); }}>
                          Match
                        </Button>
                        <Button size="sm" variant="outline" onClick={(event) => { event.stopPropagation(); handlePreparePayment(b.id); }}>
                          Prepare Payment
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {bills.length > 0 ? (
        <div className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-muted-foreground">
            Showing page {page} of {totalPages} with {bills.length} supplier bills
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

      {/* Create Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New supplier bill</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Top fields */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1 col-span-2 sm:col-span-1">
                <Label>Supplier name <span className="text-red-500">*</span></Label>
                <Input value={form.supplier_name} onChange={(e) => setForm({ ...form, supplier_name: e.target.value })} placeholder="Who sent this bill?" />
              </div>
              <div className="space-y-1 col-span-2 sm:col-span-1">
                <Label>Reference</Label>
                <Input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder="e.g. INV-001" />
              </div>
              <div className="space-y-1 col-span-2 sm:col-span-1">
                <Label>Purchase order</Label>
                <Select value={(form as any).purchase_order || 'none'} onValueChange={(value) => setForm({ ...form, purchase_order: value === 'none' ? '' : value } as any)}>
                  <SelectTrigger><SelectValue placeholder="Optional PO" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No purchase order</SelectItem>
                    {poOptions.map((po: any) => (
                      <SelectItem key={po.id} value={String(po.id)}>{po.reference} · {po.supplier_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1 col-span-2 sm:col-span-1">
                <Label>Goods receipt</Label>
                <Select value={(form as any).goods_receipt || 'none'} onValueChange={(value) => setForm({ ...form, goods_receipt: value === 'none' ? '' : value } as any)}>
                  <SelectTrigger><SelectValue placeholder="Optional GRN" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No goods receipt</SelectItem>
                    {grnOptions.map((grn: any) => (
                      <SelectItem key={grn.id} value={String(grn.id)}>{grn.receipt_number}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Issue date</Label>
                <Input type="date" value={form.issue_date} onChange={(e) => setForm({ ...form, issue_date: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>Due date</Label>
                <Input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
              </div>
              <div className="space-y-1 col-span-2">
                <Label>Notes</Label>
                <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} placeholder="Optional notes…" />
              </div>
            </div>

            {/* Line items */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">Line Items</h3>
                <p className="text-xs text-muted-foreground">Default {defaultTaxName}: {defaultTaxRate}%</p>
                <Button type="button" size="sm" variant="outline" onClick={addLine}>Add line</Button>
              </div>
              <div className="rounded border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted text-muted-foreground">
                    <tr>
                      <th className="px-2 py-1.5 text-left font-medium">Description</th>
                      <th className="px-2 py-1.5 text-right font-medium w-20">Qty</th>
                      <th className="px-2 py-1.5 text-right font-medium w-28">Unit Price</th>
                      <th className="px-2 py-1.5 text-right font-medium w-20">Tax %</th>
                      <th className="px-2 py-1.5 text-right font-medium w-28">Total</th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l, idx) => (
                      <tr key={idx} className="border-t">
                        <td className="px-1 py-1">
                          <Input value={l.description} onChange={(e) => updateLine(idx, 'description', e.target.value)} className="h-7 text-sm" placeholder="Item description" />
                        </td>
                        <td className="px-1 py-1">
                          <Input type="number" min={0} value={l.quantity} onChange={(e) => updateLine(idx, 'quantity', parseFloat(e.target.value) || 0)} className="h-7 text-sm text-right" />
                        </td>
                        <td className="px-1 py-1">
                          <Input type="number" min={0} step="0.01" value={l.unit_price} onChange={(e) => updateLine(idx, 'unit_price', parseFloat(e.target.value) || 0)} className="h-7 text-sm text-right" />
                        </td>
                        <td className="px-1 py-1">
                          <Input type="number" min={0} max={100} step="0.01" value={l.tax_rate} onChange={(e) => updateLine(idx, 'tax_rate', parseFloat(e.target.value) || 0)} className="h-7 text-sm text-right" />
                        </td>
                        <td className="px-2 py-1 text-right text-muted-foreground">
                          {fmt(lineTotal(l))}
                        </td>
                        <td className="px-1 py-1">
                          <button
                            type="button"
                            onClick={() => removeLine(idx)}
                            disabled={lines.length === 1}
                            className="text-muted-foreground hover:text-red-500 disabled:opacity-30 text-lg leading-none px-1"
                          >
                            ×
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Totals footer */}
              <div className="flex justify-end">
                <div className="w-64 space-y-1 text-sm">
                  <div className="flex justify-between text-muted-foreground">
                    <span>Subtotal</span>
                    <span>{fmt(subtotal)}</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>Tax</span>
                    <span>{fmt(totalTax)}</span>
                  </div>
                  <div className="flex justify-between font-semibold border-t pt-1">
                    <span>Total</span>
                    <span>{fmt(grandTotal)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={handleCreate} disabled={saving}>{saving ? 'Saving…' : 'Save bill'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Sheet open={!!selectedBill} onOpenChange={(value) => { if (!value) setSelectedBill(null); }}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-3xl">
          {selectedBill ? (
            <div className="space-y-6">
              <SheetHeader className="space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <SheetTitle>{selectedBill.bill_number ?? `Bill #${selectedBill.id}`}</SheetTitle>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Review supplier bill details, complete matching, approve, and prepare payment from one workspace.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge className={STATUS_COLORS[selectedBill.status] ?? 'bg-gray-100 text-gray-700'}>{selectedBill.status}</Badge>
                    <Badge variant="secondary">{selectedBill.match_status ?? 'pending match'}</Badge>
                    <Badge variant="outline">{selectedBill.payment_queue_status ?? 'not queued'}</Badge>
                  </div>
                </div>
              </SheetHeader>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Payables Workflow</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid gap-3 md:grid-cols-4">
                    {[
                      { label: 'Bill Received', active: true },
                      { label: '3-Way Match', active: (selectedBill.match_status ?? '') === 'matched' },
                      { label: 'Approval', active: ['approved', 'paid'].includes(selectedBill.status) },
                      { label: 'Payment Queue', active: !!selectedBill.payment_queue_status && selectedBill.payment_queue_status !== 'not queued' },
                    ].map((step) => (
                      <div key={step.label} className={`rounded-lg border p-3 text-sm ${step.active ? 'border-emerald-200 bg-emerald-50' : 'border-dashed bg-muted/40'}`}>
                        <div className="font-medium">{step.label}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{step.active ? 'Completed / active' : 'Pending'}</div>
                      </div>
                    ))}
                  </div>
                  {nextAction ? (
                    <div className="rounded-lg border border-sky-200 bg-sky-50 p-3">
                      <div className="text-sm font-medium text-sky-900">Next step: {nextAction.label}</div>
                      <p className="mt-1 text-sm text-sky-800">{nextAction.helper}</p>
                    </div>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" onClick={() => handleThreeWayMatch(selectedBill.id)}>Run Match</Button>
                    {(selectedBill.status === 'draft' || selectedBill.status === 'received') ? (
                      <Button variant="outline" onClick={() => handleDetailStatus('approved')}>Approve Bill</Button>
                    ) : null}
                    {selectedBill.status === 'approved' ? (
                      <Button variant="outline" onClick={() => handlePreparePayment(selectedBill.id)}>Prepare Payment</Button>
                    ) : null}
                    {selectedBill.status === 'approved' ? (
                      <Button onClick={() => handleDetailStatus('paid')}>Mark Paid</Button>
                    ) : null}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Bill Form</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-1">
                      <Label>Supplier Name</Label>
                      <Input value={detailForm.supplier_name} onChange={(e) => setDetailForm((prev) => ({ ...prev, supplier_name: e.target.value }))} />
                    </div>
                    <div className="space-y-1">
                      <Label>Reference</Label>
                      <Input value={detailForm.reference} onChange={(e) => setDetailForm((prev) => ({ ...prev, reference: e.target.value }))} />
                    </div>
                    <div className="space-y-1">
                      <Label>Purchase Order</Label>
                      <Select value={detailForm.purchase_order} onValueChange={(value) => setDetailForm((prev) => ({ ...prev, purchase_order: value }))}>
                        <SelectTrigger><SelectValue placeholder="Optional PO" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">No PO</SelectItem>
                          {poOptions.map((po: any) => (
                            <SelectItem key={po.id} value={po.reference}>{po.reference} · {po.supplier_name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label>Goods Receipt</Label>
                      <Select value={detailForm.goods_receipt} onValueChange={(value) => setDetailForm((prev) => ({ ...prev, goods_receipt: value }))}>
                        <SelectTrigger><SelectValue placeholder="Optional GRN" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">No GRN</SelectItem>
                          {grnOptions.map((grn: any) => (
                            <SelectItem key={grn.id} value={grn.receipt_number}>{grn.receipt_number}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label>Issue Date</Label>
                      <Input type="date" value={detailForm.issue_date} onChange={(e) => setDetailForm((prev) => ({ ...prev, issue_date: e.target.value }))} />
                    </div>
                    <div className="space-y-1">
                      <Label>Due Date</Label>
                      <Input type="date" value={detailForm.due_date} onChange={(e) => setDetailForm((prev) => ({ ...prev, due_date: e.target.value }))} />
                    </div>
                    <div className="space-y-1">
                      <Label>Status</Label>
                      <Select value={selectedBill.status} onValueChange={(value) => setSelectedBill((prev) => prev ? { ...prev, status: value } : prev)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="draft">Draft</SelectItem>
                          <SelectItem value="received">Received</SelectItem>
                          <SelectItem value="approved">Approved</SelectItem>
                          <SelectItem value="paid">Paid</SelectItem>
                          <SelectItem value="overdue">Overdue</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1 md:col-span-2">
                      <Label>Notes</Label>
                      <Textarea rows={3} value={detailForm.notes} onChange={(e) => setDetailForm((prev) => ({ ...prev, notes: e.target.value }))} />
                    </div>
                  </div>

                  <div className="space-y-3 rounded-lg border p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-sm font-medium">Line Items</h3>
                        <p className="text-xs text-muted-foreground">Update quantities, pricing, and tax in the same workflow.</p>
                      </div>
                      <Button type="button" size="sm" variant="outline" onClick={() => setDetailLines((prev) => [...prev, emptyLine(defaultTaxRate)])}>Add Line</Button>
                    </div>
                    <div className="space-y-3">
                      {detailLines.map((line, idx) => (
                        <div key={`${selectedBill.id}-${idx}`} className="grid gap-3 rounded-lg border p-3 md:grid-cols-[2fr,100px,140px,100px,auto]">
                          <Input
                            placeholder="Description"
                            value={line.description}
                            onChange={(e) => setDetailLines((prev) => prev.map((item, itemIdx) => itemIdx === idx ? { ...item, description: e.target.value } : item))}
                          />
                          <Input
                            type="number"
                            min={0}
                            value={line.quantity}
                            onChange={(e) => setDetailLines((prev) => prev.map((item, itemIdx) => itemIdx === idx ? { ...item, quantity: parseFloat(e.target.value) || 0 } : item))}
                          />
                          <Input
                            type="number"
                            min={0}
                            step="0.01"
                            value={line.unit_price}
                            onChange={(e) => setDetailLines((prev) => prev.map((item, itemIdx) => itemIdx === idx ? { ...item, unit_price: parseFloat(e.target.value) || 0 } : item))}
                          />
                          <Input
                            type="number"
                            min={0}
                            step="0.01"
                            value={line.tax_rate}
                            onChange={(e) => setDetailLines((prev) => prev.map((item, itemIdx) => itemIdx === idx ? { ...item, tax_rate: parseFloat(e.target.value) || 0 } : item))}
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            disabled={detailLines.length === 1}
                            onClick={() => setDetailLines((prev) => prev.filter((_, itemIdx) => itemIdx !== idx))}
                          >
                            Remove
                          </Button>
                        </div>
                      ))}
                    </div>
                    <div className="flex justify-end">
                      <div className="w-full max-w-sm space-y-2 rounded-lg bg-muted/40 p-4 text-sm">
                        <div className="flex justify-between text-muted-foreground"><span>Subtotal</span><span>{fmt(detailSubtotal)}</span></div>
                        <div className="flex justify-between text-muted-foreground"><span>Tax</span><span>{fmt(detailTaxTotal)}</span></div>
                        <div className="flex justify-between font-semibold"><span>Total</span><span>{fmt(detailGrandTotal)}</span></div>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap justify-end gap-2">
                    <Button variant="outline" onClick={() => setSelectedBill(null)}>Close</Button>
                    <Button onClick={handleUpdateSelected} disabled={detailSaving}>
                      {detailSaving ? 'Saving…' : 'Save Changes'}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
