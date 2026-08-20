import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { useAuth } from '@/context/use-auth';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { FileText, Mail, Pencil, Plus, Download, Eye, SendHorizontal, ArrowRight, Receipt, BookOpen, Trash2 } from 'lucide-react';

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, '') ?? '';
const fmt = (v: number | string) => 'KES ' + Number(v ?? 0).toLocaleString('en-KE', { minimumFractionDigits: 2 });
const today = () => new Date().toISOString().split('T')[0];

const statusColors: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  sent: 'bg-blue-100 text-blue-700',
  accepted: 'bg-emerald-100 text-emerald-700',
  declined: 'bg-red-100 text-red-700',
  expired: 'bg-amber-100 text-amber-700',
};

interface EstimateLineItem {
  id?: number;
  product: number | null;
  description: string;
  quantity: string;
  unit_price: string;
  tax_rate: string;
  discount_amount: string;
  sort_order: number;
}

interface Estimate {
  id: number;
  customer?: number | null;
  customer_name: string;
  customer_display?: string;
  estimate_number: string;
  issue_date: string;
  expiry_date: string;
  total: number;
  subtotal: number;
  tax_total: number;
  discount_total: number;
  status: string;
  notes: string;
  terms: string;
  converted_to_invoice?: number | null;
  converted_to_sales_order?: number | null;
  line_items: EstimateLineItem[];
}

interface CustomerOption {
  id: number;
  name: string;
  email?: string;
}

interface ProductOption {
  id: number;
  name: string;
  description?: string;
  unit_price: number;
  tax_rate: number;
}

function authHeaders(token: string | null, withJson = false) {
  return {
    Authorization: 'Token ' + token,
    ...(withJson ? { 'Content-Type': 'application/json' } : {}),
  };
}

function estimateLine(): EstimateLineItem {
  return {
    product: null,
    description: '',
    quantity: '1',
    unit_price: '0',
    tax_rate: '0',
    discount_amount: '0',
    sort_order: 0,
  };
}

function emptyEstimateForm() {
  return {
    customer: '',
    customer_name: '',
    issue_date: today(),
    expiry_date: '',
    status: 'draft',
    discount_total: '0',
    notes: '',
    terms: '',
    line_items: [estimateLine()],
  };
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

export default function EstimatesPage() {
  const { token } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const [filterStatus, setFilterStatus] = useState('');
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [open, setOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [emailSending, setEmailSending] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [emailTarget, setEmailTarget] = useState<Estimate | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewEstimate, setPreviewEstimate] = useState<Estimate | null>(null);
  const [previewHtml, setPreviewHtml] = useState('');
  const [emailForm, setEmailForm] = useState({ email: '', subject: '', message: '' });
  const [form, setForm] = useState<any>(emptyEstimateForm());

  const params = new URLSearchParams();
  if (filterStatus) params.set('status', filterStatus);
  if (dateFrom) params.set('date_from', dateFrom);
  if (dateTo) params.set('date_to', dateTo);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['estimates', token, filterStatus, dateFrom, dateTo],
    enabled: !!token,
    queryFn: async () => {
      const r = await fetch(BASE_URL + '/api/sales/estimates/?' + params.toString(), {
        headers: authHeaders(token),
      });
      if (!r.ok) throw new Error('Failed to fetch estimates');
      return r.json();
    },
  });

  const { data: customersData } = useQuery({
    queryKey: ['estimate-customers', token],
    enabled: !!token,
    queryFn: async () => {
      const r = await fetch(BASE_URL + '/api/sales/customers/', {
        headers: authHeaders(token),
      });
      if (!r.ok) throw new Error('Failed to fetch customers');
      return r.json();
    },
  });

  const { data: productsData } = useQuery({
    queryKey: ['estimate-products', token],
    enabled: !!token,
    queryFn: async () => {
      const r = await fetch(BASE_URL + '/api/sales/products/', {
        headers: authHeaders(token),
      });
      if (!r.ok) throw new Error('Failed to fetch products');
      return r.json();
    },
  });

  const estimates: Estimate[] = Array.isArray(data) ? data : (data?.results ?? []);
  const customers: CustomerOption[] = customersData?.customers ?? customersData?.results ?? [];
  const products: ProductOption[] = Array.isArray(productsData) ? productsData : (productsData?.results ?? []);

  const counts = {
    total: estimates.length,
    draft: estimates.filter((e) => e.status === 'draft').length,
    sent: estimates.filter((e) => e.status === 'sent').length,
    accepted: estimates.filter((e) => e.status === 'accepted').length,
  };

  const filteredEstimates = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return estimates;
    return estimates.filter((estimate) => [
      estimate.estimate_number,
      estimate.customer_display,
      estimate.customer_name,
      estimate.notes,
      estimate.terms,
    ].some((value) => (value || '').toLowerCase().includes(term)));
  }, [estimates, search]);

  const totalPages = Math.max(1, Math.ceil(filteredEstimates.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pagedEstimates = filteredEstimates.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const computed = useMemo(() => {
    const subtotal = form.line_items.reduce((sum: number, line: EstimateLineItem) => {
      const quantity = Number(line.quantity || 0);
      const unitPrice = Number(line.unit_price || 0);
      const discount = Number(line.discount_amount || 0);
      return sum + (quantity * unitPrice) - discount;
    }, 0);
    const taxTotal = form.line_items.reduce((sum: number, line: EstimateLineItem) => {
      const lineBase = (Number(line.quantity || 0) * Number(line.unit_price || 0)) - Number(line.discount_amount || 0);
      return sum + (lineBase * Number(line.tax_rate || 0)) / 100;
    }, 0);
    const total = subtotal + taxTotal - Number(form.discount_total || 0);
    return { subtotal, taxTotal, total };
  }, [form.line_items, form.discount_total]);

  function resetForm() {
    setEditingId(null);
    setForm(emptyEstimateForm());
  }

  function openCreate() {
    resetForm();
    setOpen(true);
  }

  async function openEdit(id: number) {
    try {
      const r = await fetch(BASE_URL + '/api/sales/estimates/' + id + '/', {
        headers: authHeaders(token),
      });
      if (!r.ok) throw new Error('Failed to load estimate');
      const estimate: Estimate = await r.json();
      setEditingId(estimate.id);
      setForm({
        customer: estimate.customer ? String(estimate.customer) : '',
        customer_name: estimate.customer_name ?? '',
        issue_date: estimate.issue_date ?? today(),
        expiry_date: estimate.expiry_date ?? '',
        status: estimate.status ?? 'draft',
        discount_total: String(estimate.discount_total ?? 0),
        notes: estimate.notes ?? '',
        terms: estimate.terms ?? '',
        line_items: (estimate.line_items?.length ? estimate.line_items : [estimateLine()]).map((line, index) => ({
          id: line.id,
          product: line.product ?? null,
          description: line.description ?? '',
          quantity: String(line.quantity ?? 1),
          unit_price: String(line.unit_price ?? 0),
          tax_rate: String(line.tax_rate ?? 0),
          discount_amount: String(line.discount_amount ?? 0),
          sort_order: line.sort_order ?? index,
        })),
      });
      setOpen(true);
    } catch (error: any) {
      toast({ title: 'Unable to load estimate', description: error.message, variant: 'destructive' });
    }
  }

  function setField(key: string, value: any) {
    setForm((prev: any) => ({ ...prev, [key]: value }));
  }

  function updateLine(index: number, key: keyof EstimateLineItem, value: any) {
    setForm((prev: any) => ({
      ...prev,
      line_items: prev.line_items.map((line: EstimateLineItem, idx: number) => (
        idx === index ? { ...line, [key]: value } : line
      )),
    }));
  }

  function selectProduct(index: number, value: string) {
    const product = products.find((item) => item.id === Number(value));
    updateLine(index, 'product', Number(value));
    if (product) {
      updateLine(index, 'description', product.description || product.name);
      updateLine(index, 'unit_price', String(product.unit_price ?? 0));
      updateLine(index, 'tax_rate', String(product.tax_rate ?? 0));
    }
  }

  function addLine() {
    setForm((prev: any) => ({
      ...prev,
      line_items: [...prev.line_items, { ...estimateLine(), sort_order: prev.line_items.length }],
    }));
  }

  function removeLine(index: number) {
    setForm((prev: any) => ({
      ...prev,
      line_items: prev.line_items.length === 1
        ? [estimateLine()]
        : prev.line_items.filter((_: EstimateLineItem, idx: number) => idx !== index).map((line: EstimateLineItem, idx: number) => ({ ...line, sort_order: idx })),
    }));
  }

  async function handleSave() {
    const validLines = form.line_items
      .map((line: EstimateLineItem, index: number) => ({ ...line, sort_order: index }))
      .filter((line: EstimateLineItem) => line.description.trim());

    if (!form.customer && !form.customer_name.trim()) {
      toast({ title: 'Customer is required', variant: 'destructive' });
      return;
    }
    if (validLines.length === 0) {
      toast({ title: 'Add at least one line item', variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      const payload = {
        customer: form.customer ? Number(form.customer) : null,
        customer_name: form.customer ? '' : form.customer_name.trim(),
        issue_date: form.issue_date,
        expiry_date: form.expiry_date || null,
        status: form.status,
        discount_total: Number(form.discount_total || 0),
        notes: form.notes,
        terms: form.terms,
        line_items: validLines.map((line: EstimateLineItem, index: number) => ({
          product: line.product ? Number(line.product) : null,
          description: line.description.trim(),
          quantity: Number(line.quantity || 0),
          unit_price: Number(line.unit_price || 0),
          tax_rate: Number(line.tax_rate || 0),
          discount_amount: Number(line.discount_amount || 0),
          sort_order: index,
        })),
      };

      const url = editingId
        ? BASE_URL + '/api/sales/estimates/' + editingId + '/'
        : BASE_URL + '/api/sales/estimates/';
      const method = editingId ? 'PATCH' : 'POST';
      const r = await fetch(url, {
        method,
        headers: authHeaders(token, true),
        body: JSON.stringify(payload),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(parseErrorMessage(body, 'Failed to save estimate'));

      toast({ title: editingId ? 'Estimate updated' : 'Estimate created successfully' });
      setOpen(false);
      resetForm();
      refetch();
    } catch (error: any) {
      toast({ title: 'Error saving estimate', description: error.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  async function handlePatch(id: number, status: string) {
    try {
      const r = await fetch(BASE_URL + '/api/sales/estimates/' + id + '/', {
        method: 'PATCH',
        headers: authHeaders(token, true),
        body: JSON.stringify({ status }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(parseErrorMessage(body, 'Failed to update estimate'));
      toast({ title: 'Estimate updated' });
      if (previewEstimate?.id === id) {
        setPreviewEstimate((prev) => prev ? { ...prev, status } : prev);
      }
      refetch();
    } catch (error: any) {
      toast({ title: 'Error updating estimate', description: error.message, variant: 'destructive' });
    }
  }

  async function handleConvertToOrder(id: number) {
    try {
      const r = await fetch(BASE_URL + '/api/sales/estimates/' + id + '/convert-to-order/', {
        method: 'POST',
        headers: authHeaders(token),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(parseErrorMessage(body, 'Failed to convert estimate'));
      toast({ title: 'Sales order created from estimate' });
      if (previewEstimate?.id === id) {
        setPreviewEstimate((prev) => prev ? {
          ...prev,
          status: 'accepted',
          converted_to_sales_order: body.sales_order_id,
        } : prev);
      }
      refetch();
    } catch (error: any) {
      toast({ title: 'Error converting estimate', description: error.message, variant: 'destructive' });
    }
  }

  async function handlePreview(id: number) {
    setPreviewOpen(true);
    setPreviewLoading(true);
    try {
      const [detailRes, docRes] = await Promise.all([
        fetch(BASE_URL + '/api/sales/estimates/' + id + '/', { headers: authHeaders(token) }),
        fetch(BASE_URL + '/api/sales/estimates/' + id + '/document/', { headers: authHeaders(token) }),
      ]);
      if (!detailRes.ok || !docRes.ok) throw new Error('Failed to load estimate preview');
      const detail = await detailRes.json();
      const html = await docRes.text();
      setPreviewEstimate(detail);
      setPreviewHtml(html);
    } catch (error: any) {
      setPreviewOpen(false);
      toast({ title: 'Unable to open estimate', description: error.message, variant: 'destructive' });
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleDownload(estimate: Estimate) {
    try {
      const r = await fetch(BASE_URL + '/api/sales/estimates/' + estimate.id + '/document/?download=1', {
        headers: authHeaders(token),
      });
      if (!r.ok) throw new Error('Failed to download estimate');
      const html = await r.text();
      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${estimate.estimate_number}.html`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error: any) {
      toast({ title: 'Download failed', description: error.message, variant: 'destructive' });
    }
  }

  function openEmailDialog(estimate: Estimate) {
    const customer = customers.find((item) => item.id === estimate.customer);
    setEmailTarget(estimate);
    setEmailForm({
      email: customer?.email || '',
      subject: `Estimate ${estimate.estimate_number}`,
      message: '',
    });
    setEmailOpen(true);
  }

  async function handleEmailSend() {
    if (!emailTarget) return;
    setEmailSending(true);
    try {
      const r = await fetch(BASE_URL + '/api/sales/estimates/' + emailTarget.id + '/email/', {
        method: 'POST',
        headers: authHeaders(token, true),
        body: JSON.stringify(emailForm),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(parseErrorMessage(body, 'Failed to send estimate email'));
      toast({ title: 'Estimate emailed', description: body.message });
      setEmailOpen(false);
      setEmailTarget(null);
    } catch (error: any) {
      toast({ title: 'Email failed', description: error.message, variant: 'destructive' });
    } finally {
      setEmailSending(false);
    }
  }

  async function handleConvertToInvoice(id: number) {
    try {
      const r = await fetch(BASE_URL + '/api/sales/estimates/' + id + '/convert/', {
        method: 'POST',
        headers: authHeaders(token),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(parseErrorMessage(body, 'Failed to convert estimate to invoice'));
      toast({ title: 'Draft invoice created from estimate' });
      refetch();
      if (previewEstimate?.id === id) {
        setPreviewEstimate((prev) => prev ? { ...prev, converted_to_invoice: body.invoice_id } : prev);
      }
    } catch (error: any) {
      toast({ title: 'Convert failed', description: error.message, variant: 'destructive' });
    }
  }

  async function handleConvertOrderToInvoice(orderId: number) {
    try {
      const r = await fetch(BASE_URL + '/api/sales/sales-orders/' + orderId + '/convert/', {
        method: 'POST',
        headers: authHeaders(token),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(parseErrorMessage(body, 'Failed to convert sales order to invoice'));
      toast({ title: 'Draft invoice created from sales order' });
      refetch();
      if (previewEstimate) {
        setPreviewEstimate({ ...previewEstimate, converted_to_invoice: body.invoice_id });
      }
    } catch (error: any) {
      toast({ title: 'Convert failed', description: error.message, variant: 'destructive' });
    }
  }

  const flowSteps = previewEstimate ? [
    { label: 'Estimate Drafted', active: true },
    { label: 'Estimate Sent', active: ['sent', 'accepted'].includes(previewEstimate.status) || !!previewEstimate.converted_to_sales_order || !!previewEstimate.converted_to_invoice },
    { label: 'Estimate Accepted', active: previewEstimate.status === 'accepted' || !!previewEstimate.converted_to_sales_order || !!previewEstimate.converted_to_invoice },
    { label: 'Sales Order Created', active: !!previewEstimate.converted_to_sales_order },
    { label: 'Draft Invoice Created', active: !!previewEstimate.converted_to_invoice },
    { label: 'Accounting Posted On Issue', active: false },
  ] : [];

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Quotes</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Create quotes, review line items, and move accepted work into orders or invoices.
          </p>
        </div>
        <Button onClick={openCreate} className="gap-2">
          <Plus className="h-4 w-4" />
          New Quote
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: 'Total', value: counts.total },
          { label: 'Draft', value: counts.draft },
          { label: 'Sent', value: counts.sent },
          { label: 'Accepted', value: counts.accepted },
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
            placeholder="Search quote number, customer, or notes"
            className="w-full md:w-72"
          />
          <Select value={filterStatus || '__all__'} onValueChange={(value) => { setFilterStatus(value === '__all__' ? '' : value); setPage(1); }}>
            <SelectTrigger className="w-full md:w-44">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All statuses</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="sent">Sent</SelectItem>
              <SelectItem value="accepted">Accepted</SelectItem>
              <SelectItem value="declined">Declined</SelectItem>
              <SelectItem value="expired">Expired</SelectItem>
            </SelectContent>
          </Select>
          <Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} className="w-full md:w-44" />
          <Input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} className="w-full md:w-44" />
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">Rows</span>
          <Select value={String(pageSize)} onValueChange={(value) => { setPageSize(Number(value)); setPage(1); }}>
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
      ) : pagedEstimates.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-2">
          <FileText className="h-10 w-10 opacity-40" />
          <p>No quotes found</p>
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Quote #</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Valid Until</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pagedEstimates.map((estimate) => (
                <TableRow key={estimate.id} className="hover:bg-muted/50">
                  <TableCell className="font-medium">{estimate.estimate_number}</TableCell>
                  <TableCell>{estimate.customer_display || estimate.customer_name || 'Walk-in customer'}</TableCell>
                  <TableCell>{estimate.issue_date}</TableCell>
                  <TableCell>{estimate.expiry_date || '—'}</TableCell>
                  <TableCell>{fmt(estimate.total)}</TableCell>
                  <TableCell>
                    <Badge className={statusColors[estimate.status] ?? 'bg-gray-100 text-gray-700'}>
                      {estimate.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      <Button size="sm" variant="ghost" onClick={() => handlePreview(estimate.id)}>
                        <Eye className="h-4 w-4 mr-1" /> Preview
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => openEdit(estimate.id)}>
                        <Pencil className="h-4 w-4 mr-1" /> Edit
                      </Button>
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
          Showing {filteredEstimates.length ? (currentPage - 1) * pageSize + 1 : 0}
          {' '}to {Math.min(currentPage * pageSize, filteredEstimates.length)} of {filteredEstimates.length} quotes
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={currentPage <= 1} onClick={() => setPage((prev) => Math.max(prev - 1, 1))}>
            Previous
          </Button>
          <Button variant="outline" size="sm" disabled={currentPage >= totalPages} onClick={() => setPage((prev) => Math.min(prev + 1, totalPages))}>
            Next
          </Button>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit Quote' : 'New Quote'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-5 py-2">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Customer</Label>
                <Select value={form.customer || '__manual__'} onValueChange={(value) => setField('customer', value === '__manual__' ? '' : value)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select existing customer" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__manual__">Manual / one-off customer</SelectItem>
                    {customers.map((customer) => (
                      <SelectItem key={customer.id} value={String(customer.id)}>{customer.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Customer Name</Label>
                <Input
                  value={form.customer_name}
                  onChange={(e) => setField('customer_name', e.target.value)}
                  placeholder="Used for one-off estimates"
                  disabled={!!form.customer}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Issue Date</Label>
                <Input type="date" value={form.issue_date} onChange={(e) => setField('issue_date', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Expiry Date</Label>
                <Input type="date" value={form.expiry_date} onChange={(e) => setField('expiry_date', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(value) => setField('status', value)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="sent">Sent</SelectItem>
                    <SelectItem value="accepted">Accepted</SelectItem>
                    <SelectItem value="declined">Declined</SelectItem>
                    <SelectItem value="expired">Expired</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Document Discount</Label>
                <Input type="number" min="0" step="0.01" value={form.discount_total} onChange={(e) => setField('discount_total', e.target.value)} />
              </div>
            </div>

            <div className="border rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold">Line Items</p>
                  <p className="text-xs text-muted-foreground">Build the estimate lines here. Product selection can prefill pricing and tax.</p>
                </div>
                <Button size="sm" variant="outline" onClick={addLine}>
                  <Plus className="h-4 w-4 mr-1" /> Add Line
                </Button>
              </div>

              <div className="space-y-3">
                {form.line_items.map((line: EstimateLineItem, index: number) => (
                  <div key={index} className="grid grid-cols-12 gap-2 items-end border rounded-md p-3">
                    <div className="col-span-12 md:col-span-3 space-y-1">
                      <Label>Product</Label>
                      <Select value={line.product ? String(line.product) : '__none__'} onValueChange={(value) => value === '__none__' ? updateLine(index, 'product', null) : selectProduct(index, value)}>
                        <SelectTrigger><SelectValue placeholder="Optional product" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">Manual line</SelectItem>
                          {products.map((product) => (
                            <SelectItem key={product.id} value={String(product.id)}>{product.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-12 md:col-span-4 space-y-1">
                      <Label>Description</Label>
                      <Input value={line.description} onChange={(e) => updateLine(index, 'description', e.target.value)} placeholder="Line description" />
                    </div>
                    <div className="col-span-6 md:col-span-1 space-y-1">
                      <Label>Qty</Label>
                      <Input type="number" min="0" step="0.001" value={line.quantity} onChange={(e) => updateLine(index, 'quantity', e.target.value)} />
                    </div>
                    <div className="col-span-6 md:col-span-1 space-y-1">
                      <Label>Price</Label>
                      <Input type="number" min="0" step="0.01" value={line.unit_price} onChange={(e) => updateLine(index, 'unit_price', e.target.value)} />
                    </div>
                    <div className="col-span-6 md:col-span-1 space-y-1">
                      <Label>Tax %</Label>
                      <Input type="number" min="0" step="0.01" value={line.tax_rate} onChange={(e) => updateLine(index, 'tax_rate', e.target.value)} />
                    </div>
                    <div className="col-span-6 md:col-span-1 space-y-1">
                      <Label>Discount</Label>
                      <Input type="number" min="0" step="0.01" value={line.discount_amount} onChange={(e) => updateLine(index, 'discount_amount', e.target.value)} />
                    </div>
                    <div className="col-span-12 md:col-span-1 flex justify-end">
                      <Button size="sm" variant="ghost" onClick={() => removeLine(index)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap justify-end gap-6 border-t pt-3 text-sm">
                <div><span className="text-muted-foreground mr-2">Subtotal</span><span className="font-mono font-semibold">{fmt(computed.subtotal)}</span></div>
                <div><span className="text-muted-foreground mr-2">Tax</span><span className="font-mono font-semibold">{fmt(computed.taxTotal)}</span></div>
                <div><span className="text-muted-foreground mr-2">Total</span><span className="font-mono font-bold">{fmt(computed.total)}</span></div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Notes</Label>
                <Textarea value={form.notes} onChange={(e) => setField('notes', e.target.value)} className="min-h-[110px]" placeholder="Internal or customer-facing notes" />
              </div>
              <div className="space-y-1.5">
                <Label>Terms</Label>
                <Textarea value={form.terms} onChange={(e) => setField('terms', e.target.value)} className="min-h-[110px]" placeholder="Payment terms, validity, delivery terms" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setOpen(false); resetForm(); }}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : editingId ? 'Save Changes' : 'Create Quote'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={emailOpen} onOpenChange={setEmailOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Email Quote</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Recipient Email</Label>
              <Input
                type="email"
                value={emailForm.email}
                onChange={(e) => setEmailForm((prev) => ({ ...prev, email: e.target.value }))}
                placeholder="customer@example.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Subject</Label>
              <Input
                value={emailForm.subject}
                onChange={(e) => setEmailForm((prev) => ({ ...prev, subject: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Message</Label>
              <Textarea
                value={emailForm.message}
                onChange={(e) => setEmailForm((prev) => ({ ...prev, message: e.target.value }))}
                placeholder="Optional message to appear above the estimate template"
                className="min-h-[120px]"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEmailOpen(false)}>Cancel</Button>
            <Button onClick={handleEmailSend} disabled={emailSending}>
              {emailSending ? 'Sending…' : 'Send Quote'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-6xl max-h-[94vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{previewEstimate?.estimate_number || 'Quote Preview'}</DialogTitle>
          </DialogHeader>
          {previewLoading || !previewEstimate ? (
            <div className="py-16 text-center text-muted-foreground">Loading preview…</div>
          ) : (
            <div className="space-y-5">
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => handleDownload(previewEstimate)}>
                  <Download className="h-4 w-4 mr-1" /> Download
                </Button>
                <Button size="sm" variant="outline" onClick={() => openEmailDialog(previewEstimate)}>
                  <Mail className="h-4 w-4 mr-1" /> Email
                </Button>
                {previewEstimate.status === 'draft' && (
                  <Button size="sm" variant="outline" onClick={() => handlePatch(previewEstimate.id, 'sent')}>
                    <SendHorizontal className="h-4 w-4 mr-1" /> Mark Sent
                  </Button>
                )}
                {(previewEstimate.status === 'draft' || previewEstimate.status === 'sent') && (
                  <Button size="sm" variant="outline" onClick={() => handlePatch(previewEstimate.id, 'accepted')}>
                    <ArrowRight className="h-4 w-4 mr-1" /> Mark Accepted
                  </Button>
                )}
                {previewEstimate.status === 'accepted' && !previewEstimate.converted_to_sales_order && (
                  <Button size="sm" variant="outline" onClick={() => handleConvertToOrder(previewEstimate.id)}>
                    <FileText className="h-4 w-4 mr-1" /> Create Order
                  </Button>
                )}
                {previewEstimate.status === 'accepted' && !previewEstimate.converted_to_invoice && (
                  <Button size="sm" variant="outline" onClick={() => handleConvertToInvoice(previewEstimate.id)}>
                    <Receipt className="h-4 w-4 mr-1" /> Create Draft Invoice
                  </Button>
                )}
                {previewEstimate.converted_to_sales_order && !previewEstimate.converted_to_invoice && (
                  <Button size="sm" variant="outline" onClick={() => handleConvertOrderToInvoice(previewEstimate.converted_to_sales_order!)}>
                    <Receipt className="h-4 w-4 mr-1" /> Create Invoice From Order
                  </Button>
                )}
                {previewEstimate.converted_to_sales_order && (
                  <Button size="sm" variant="outline" onClick={() => navigate('/sales/orders')}>
                    <ArrowRight className="h-4 w-4 mr-1" /> View Orders
                  </Button>
                )}
                {previewEstimate.converted_to_invoice && (
                  <Button size="sm" variant="outline" onClick={() => navigate(`/payments/invoices/${previewEstimate.converted_to_invoice}`)}>
                    <Receipt className="h-4 w-4 mr-1" /> Open Invoice
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={() => navigate('/accounting/transactions')}>
                  <BookOpen className="h-4 w-4 mr-1" /> Accounting
                </Button>
              </div>

              <div className="rounded-lg border p-4 space-y-3">
                <div>
                  <p className="text-sm font-semibold">Sales Flow</p>
                  <p className="text-xs text-muted-foreground">
                    Once a quote is accepted, create the order for operations. Accounting starts when the invoice is issued, not when the quote or order is created.
                  </p>
                </div>
                <div className="grid gap-2 md:grid-cols-6">
                  {flowSteps.map((step) => (
                    <div key={step.label} className={`rounded-md border px-3 py-2 text-xs font-medium ${step.active ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-muted/30 text-muted-foreground'}`}>
                      {step.label}
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <Card>
                  <CardContent className="pt-4">
                    <p className="text-xs text-muted-foreground">Customer</p>
                    <p className="font-semibold mt-1">{previewEstimate.customer_display || previewEstimate.customer_name || 'Walk-in customer'}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <p className="text-xs text-muted-foreground">Sales Order</p>
                    <p className="font-semibold mt-1">{previewEstimate.converted_to_sales_order ? `Order created (#${previewEstimate.converted_to_sales_order})` : 'Not created yet'}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <p className="text-xs text-muted-foreground">Invoice</p>
                    <p className="font-semibold mt-1">{previewEstimate.converted_to_invoice ? `Draft invoice (#${previewEstimate.converted_to_invoice})` : 'Not created yet'}</p>
                  </CardContent>
                </Card>
              </div>

              <div className="rounded-lg border overflow-hidden">
                <iframe title="Estimate Preview" srcDoc={previewHtml} className="w-full min-h-[70vh] bg-white" />
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
