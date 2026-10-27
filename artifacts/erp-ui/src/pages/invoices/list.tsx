/* Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu. */
import { useState, useCallback } from 'react';
import { Link, useLocation } from 'wouter';
import {
  useGetPaymentSummary, getGetPaymentSummaryQueryKey,
  useListPaymentMethods, getListPaymentMethodsQueryKey,
} from '@workspace/api-client-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import {
  FileText, DollarSign, AlertCircle, Search, Plus, ChevronRight,
  CheckCircle2, Clock, Package, X, ArrowRight, Users, Layers, ChevronLeft, Download,
} from 'lucide-react';

/* ─────────────────────────────────────────── helpers ── */
function kes(v: number | null | undefined) {
  const n = Number(v ?? 0);
  return `KES ${n.toLocaleString('en-KE', { minimumFractionDigits: 2 })}`;
}

const STATUS_META: Record<string, { cls: string; label: string }> = {
  draft:   { cls: 'bg-secondary text-secondary-foreground border-border', label: 'Draft' },
  issued:  { cls: 'bg-blue-100 text-blue-800 border-blue-200',            label: 'Issued' },
  paid:    { cls: 'bg-emerald-100 text-emerald-800 border-emerald-200',   label: 'Paid' },
  overdue: { cls: 'bg-red-100 text-red-800 border-red-200',               label: 'Overdue' },
  Pending: { cls: 'bg-amber-100 text-amber-800 border-amber-200',         label: 'Pending' },
  Paid:    { cls: 'bg-emerald-100 text-emerald-800 border-emerald-200',   label: 'Paid' },
};

function StatusBadge({ s }: { s: string }) {
  const m = STATUS_META[s] ?? { cls: 'bg-secondary border-border', label: s };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold tracking-widest uppercase border ${m.cls}`}>
      {m.label}
    </span>
  );
}

/* ─────────────────────────────────────────── Source Module Badge ── */
const MODULE_META: Record<string, { cls: string; label: string }> = {
  weighbridge:  { cls: 'bg-indigo-100 text-indigo-800 border-indigo-200',   label: 'Weighbridge' },
  hr:           { cls: 'bg-purple-100 text-purple-800 border-purple-200',   label: 'HR' },
  procurement:  { cls: 'bg-amber-100 text-amber-800 border-amber-200',      label: 'Procurement' },
  crm:          { cls: 'bg-sky-100 text-sky-800 border-sky-200',            label: 'CRM' },
  manual:       { cls: 'bg-gray-100 text-gray-800 border-gray-200',         label: 'Manual' },
};

function SourceBadge({ module }: { module?: string }) {
  const m = MODULE_META[module ?? 'manual'] ?? MODULE_META['manual'];
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold tracking-widest uppercase border ${m.cls}`}>
      {m.label}
    </span>
  );
}

/* ─────────────────────────────────────────── Generate Invoice dialog ── */
interface GenerateDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  token: string | null;
  onSuccess: (id: number) => void;
}

function GenerateInvoiceDialog({ open, onOpenChange, token, onSuccess }: GenerateDialogProps) {
  const { toast } = useToast();
  const [step, setStep] = useState<'customer' | 'transactions'>('customer');
  const [customerId, setCustomerId] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<any | null>(null);
  const [selectedTxnIds, setSelectedTxnIds] = useState<Set<number>>(new Set());
  const [dueDays, setDueDays] = useState('30');
  const [currency, setCurrency] = useState('KES');
  const [notes, setNotes] = useState('');
  const [generating, setGenerating] = useState(false);

  const { data: customersData } = useQuery({
    queryKey: ['invoice-customers', customerSearch],
    queryFn: async () => {
      const qs = customerSearch ? `?search=${encodeURIComponent(customerSearch)}` : '';
      const res = await fetch(`/api/payments/customers/${qs}`, { headers: { Authorization: `Token ${token}` } });
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    enabled: !!token && open && step === 'customer',
    staleTime: 15_000,
  });

  const { data: txnsData, isLoading: txnsLoading } = useQuery({
    queryKey: ['uninvoiced-txns', customerId],
    queryFn: async () => {
      const res = await fetch(`/api/payments/uninvoiced-transactions/?customer_id=${customerId}`, {
        headers: { Authorization: `Token ${token}` },
      });
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    enabled: !!token && !!customerId && step === 'transactions',
    staleTime: 10_000,
  });

  const customers: any[] = customersData?.results ?? [];
  const txns: any[] = txnsData?.results ?? [];
  const selectedTotal = txns
    .filter(t => selectedTxnIds.has(t.id))
    .reduce((s, t) => s + t.charge, 0);

  const toggleTxn = (id: number) =>
    setSelectedTxnIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const selectAll = () => setSelectedTxnIds(new Set(txns.map(t => t.id)));
  const clearAll  = () => setSelectedTxnIds(new Set());

  const handleGenerate = async () => {
    if (selectedTxnIds.size === 0) {
      toast({ title: 'Select at least one transaction', variant: 'destructive' }); return;
    }
    setGenerating(true);
    try {
      const res = await fetch('/api/payments/invoices/generate/', {
        method: 'POST',
        headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_id:     parseInt(customerId),
          transaction_ids: Array.from(selectedTxnIds),
          due_days:        parseInt(dueDays) || 30,
          currency,
          notes,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? res.statusText);
      const inv = await res.json();
      toast({ title: `Invoice ${inv.invoice_number} created` });
      onSuccess(inv.id);
      onOpenChange(false);
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setGenerating(false);
    }
  };

  const reset = () => {
    setStep('customer'); setCustomerId(''); setSelectedCustomer(null);
    setSelectedTxnIds(new Set()); setDueDays('30'); setCurrency('KES'); setNotes('');
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-h-[94dvh] w-[calc(100vw-1rem)] max-w-5xl overflow-y-auto p-4 sm:w-[calc(100vw-2rem)] sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Generate Invoice
            {step === 'transactions' && selectedCustomer && (
              <span className="text-sm text-muted-foreground font-normal">— {selectedCustomer.name}</span>
            )}
          </DialogTitle>
        </DialogHeader>

        {step === 'customer' ? (
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Search Customer</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Type name to filter…"
                  value={customerSearch}
                  onChange={e => setCustomerSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>
            <div className="border rounded-lg divide-y max-h-64 overflow-y-auto">
              {customers.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">No customers found</div>
              ) : customers.map((c: any) => (
                <button
                  key={c.id}
                  className={`w-full text-left px-4 py-2.5 hover:bg-muted/50 transition-colors flex items-center justify-between ${customerId === String(c.id) ? 'bg-primary/5 border-l-2 border-l-primary' : ''}`}
                  onClick={() => { setCustomerId(String(c.id)); setSelectedCustomer(c); }}
                >
                  <div>
                    <div className="font-medium text-sm">{c.name}</div>
                    <div className="text-xs text-muted-foreground">{c.email || c.phone || '—'}</div>
                  </div>
                  {customerId === String(c.id) && <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4 py-2">
            {txnsLoading ? (
              <div className="py-8 text-center text-sm text-muted-foreground animate-pulse">Loading transactions…</div>
            ) : txns.length === 0 ? (
              <div className="py-8 text-center space-y-2">
                <Package className="h-10 w-10 text-muted-foreground/30 mx-auto" />
                <p className="text-sm text-muted-foreground">No uninvoiced completed transactions for this customer.</p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">{txns.length} uninvoiced transaction{txns.length !== 1 ? 's' : ''}</p>
                  <div className="flex gap-2">
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={selectAll}>Select All</Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={clearAll}>Clear</Button>
                  </div>
                </div>
                <div className="border rounded-lg divide-y max-h-52 overflow-y-auto">
                  {txns.map((t: any) => (
                    <label key={t.id} className="flex items-center gap-3 px-3 py-2 hover:bg-muted/40 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedTxnIds.has(t.id)}
                        onChange={() => toggleTxn(t.id)}
                        className="rounded"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-mono font-bold">TX-{String(t.id).padStart(5, '0')} · {t.vehicle_plate}</div>
                        <div className="text-[10px] text-muted-foreground">{t.vehicle_type} · {t.net_weight?.toLocaleString()} kg · {t.destination}</div>
                      </div>
                      <div className="text-sm font-mono font-bold shrink-0">{kes(t.charge)}</div>
                    </label>
                  ))}
                </div>
              </>
            )}

            {/* Options */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Due Days</Label>
                <Input type="number" min="1" value={dueDays} onChange={e => setDueDays(e.target.value)} className="h-8" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Currency</Label>
                <Select value={currency} onValueChange={setCurrency}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['KES','USD','EUR','GBP'].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Notes</Label>
              <Textarea placeholder="Optional notes…" value={notes} onChange={e => setNotes(e.target.value)} className="h-16 text-sm" />
            </div>

            {selectedTxnIds.size > 0 && (
              <div className="bg-primary/5 border border-primary/20 rounded p-3 flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{selectedTxnIds.size} transaction{selectedTxnIds.size !== 1 ? 's' : ''} selected</span>
                <span className="font-mono font-bold text-primary">{kes(selectedTotal)}</span>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {step === 'customer' ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button
                disabled={!customerId}
                onClick={() => setStep('transactions')}
                className="gap-1.5"
              >
                Next <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setStep('customer')}>← Back</Button>
              <Button onClick={handleGenerate} disabled={generating || selectedTxnIds.size === 0}>
                {generating ? 'Generating…' : 'Generate Invoice'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─────────────────────────────────────────── New (Manual) Invoice dialog ── */
interface NewInvoiceDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  token: string | null;
  onSuccess: (id: number) => void;
}

interface LineItem {
  product_id: number | null;
  description: string;
  qty: number;
  unit_price: number;
  tax_rate: number;
}

function NewInvoiceDialog({ open, onOpenChange, token, onSuccess }: NewInvoiceDialogProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  const tenantId = (user as any)?.organization_id ?? (user as any)?.tenant_id;
  const [customerId, setCustomerId] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [currency, setCurrency] = useState('KES');
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<LineItem[]>([{ product_id: null, description: '', qty: 1, unit_price: 0, tax_rate: 0 }]);
  const [taxMode, setTaxMode] = useState<'per_line' | 'combined'>('per_line');
  const [combinedTaxRate, setCombinedTaxRate] = useState(0);
  const [chargeIds, setChargeIds] = useState<number[]>([]);
  const [newProduct, setNewProduct] = useState({ name: '', description: '', unit_price: '', product_type: 'service' });
  const [showNewProduct, setShowNewProduct] = useState(false);
  const [creatingProduct, setCreatingProduct] = useState(false);
  const [saving, setSaving] = useState(false);

  const { data: customersData } = useQuery({
    queryKey: ['invoice-customers-new', customerSearch],
    queryFn: async () => {
      const qs = customerSearch ? `?search=${encodeURIComponent(customerSearch)}` : '';
      const res = await fetch(`/api/payments/customers/${qs}`, { headers: { Authorization: `Token ${token}` } });
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    enabled: !!token && open,
    staleTime: 15_000,
  });

  const customers: any[] = customersData?.results ?? [];
  const { data: productsData, refetch: refetchProducts } = useQuery({
    queryKey: ['invoice-products-new'],
    queryFn: async () => {
      const res = await fetch('/api/sales/products/?is_active=true&page_size=100', { headers: { Authorization: `Token ${token}` } });
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    enabled: !!token && open,
  });
  const products: any[] = productsData?.results ?? productsData ?? [];
  const { data: settingsData } = useQuery({ queryKey: ['invoice-tax-settings', tenantId], queryFn: async () => (await fetch(`/api/platform/tenants/${tenantId}/settings/`, { headers: { Authorization: `Token ${token}` } })).json(), enabled: !!token && !!tenantId && open });
  const settings = settingsData?.data ?? settingsData ?? {};
  const { data: chargesData } = useQuery({ queryKey: ['invoice-charges'], queryFn: async () => (await fetch('/api/sales/charges/', { headers: { Authorization: `Token ${token}` } })).json(), enabled: !!token && open });
  const charges: any[] = chargesData?.results ?? chargesData ?? [];
  const subtotal = lines.reduce((s, l) => s + l.qty * l.unit_price, 0);
  const taxTotal = taxMode === 'combined' ? subtotal * combinedTaxRate / 100 : lines.reduce((s, l) => s + (l.qty * l.unit_price * l.tax_rate / 100), 0);
  const chargeTotal = charges.filter(charge => chargeIds.includes(charge.id)).reduce((sum, charge) => sum + (charge.calculation_type === 'percentage' ? subtotal * Number(charge.rate) / 100 : Number(charge.rate)), 0);
  const total = subtotal + taxTotal + chargeTotal;

  const addLine = () => setLines(prev => [...prev, { product_id: null, description: '', qty: 1, unit_price: 0, tax_rate: Number(settings?.default_tax_rate ?? 0) }]);
  const removeLine = (i: number) => setLines(prev => prev.filter((_, idx) => idx !== i));
  const updateLine = (i: number, field: keyof LineItem, val: string | number) =>
    setLines(prev => prev.map((l, idx) => idx === i ? { ...l, [field]: val } : l));
  const selectProduct = (i: number, value: string) => {
    const product = products.find(item => String(item.id) === value);
    setLines(prev => prev.map((line, idx) => idx === i ? {
      ...line,
      product_id: product?.id ?? null,
      description: product?.description || product?.name || line.description,
      unit_price: Number(product?.unit_price ?? line.unit_price),
      tax_rate: Number(product?.tax_rate ?? line.tax_rate),
    } : line));
  };
  const createProduct = async () => {
    const name = newProduct.name.trim();
    if (!name) {
      toast({ title: 'Enter a product or service name', variant: 'destructive' });
      return;
    }
    const unitPrice = Number(newProduct.unit_price || 0);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      toast({ title: 'Enter a valid unit price', variant: 'destructive' });
      return;
    }
    setCreatingProduct(true);
    try {
      const response = await fetch('/api/sales/products/', {
        method: 'POST',
        headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...newProduct, name, unit_price: unitPrice, is_active: true, is_sales_item: true }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const firstError = Object.values(body).flat().find(Boolean);
        throw new Error(typeof body.detail === 'string' ? body.detail : typeof body.error === 'string' ? body.error : typeof firstError === 'string' ? firstError : 'Product or service could not be created.');
      }
      await refetchProducts();
      setLines(prev => prev.map((line, index) => index === prev.length - 1 ? {
        ...line,
        product_id: body.id,
        description: body.description || body.name,
        unit_price: Number(body.unit_price),
        tax_rate: Number(body.tax_rate ?? line.tax_rate),
      } : line));
      setNewProduct({ name: '', description: '', unit_price: '', product_type: 'service' });
      setShowNewProduct(false);
      toast({ title: `${body.name} saved`, description: 'It has been added to this invoice and the product catalogue.' });
    } catch (error: any) {
      toast({ title: 'Could not save product or service', description: error.message, variant: 'destructive' });
    } finally {
      setCreatingProduct(false);
    }
  };

  const handleSave = async () => {
    if (!customerId) { toast({ title: 'Select a customer', variant: 'destructive' }); return; }
    if (lines.every(l => !l.description)) { toast({ title: 'Add at least one line item', variant: 'destructive' }); return; }

    setSaving(true);
    try {
      const res = await fetch('/api/payments/invoices/', {
        method: 'POST',
        headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_id:   parseInt(customerId),
          line_items:    lines.filter(l => l.description),
          currency,
          due_date:      dueDate || undefined,
          notes,
          source_module: 'manual',
          tax_mode: taxMode,
          combined_tax_rate: combinedTaxRate,
          charge_ids: chargeIds,
        }),
      });
      const contentType = res.headers.get('content-type') ?? '';
      const body = contentType.includes('application/json')
        ? await res.json().catch(() => ({}))
        : { error: `The invoice service returned an unexpected response (${res.status}). Please try again or contact an administrator.` };
      if (!res.ok) {
        const firstError = Object.values(body).flat().find(Boolean);
        throw new Error(typeof body.error === 'string' ? body.error : typeof body.detail === 'string' ? body.detail : typeof firstError === 'string' ? firstError : res.statusText);
      }
      const inv = body;
      toast({ title: `Invoice ${inv.invoice_number} created` });
      onSuccess(inv.id);
      onOpenChange(false);
    } catch (e: any) {
      toast({ title: 'Error creating invoice', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setCustomerId(''); setCustomerSearch(''); setCurrency('KES');
    setDueDate(''); setNotes('');
    setLines([{ product_id: null, description: '', qty: 1, unit_price: 0, tax_rate: Number(settings?.default_tax_rate ?? 0) }]);
    setTaxMode('per_line'); setCombinedTaxRate(Number(settings?.default_tax_rate ?? 0)); setChargeIds([]);
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-4 w-4" /> New Invoice
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Customer picker */}
          <div className="space-y-1.5">
            <Label>Customer</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search customer…"
                value={customerSearch}
                onChange={e => setCustomerSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            {customers.length > 0 && (
              <div className="border rounded-lg divide-y max-h-36 overflow-y-auto">
                {customers.slice(0, 8).map((c: any) => (
                  <button
                    key={c.id}
                    className={`w-full text-left px-4 py-2 hover:bg-muted/50 transition-colors flex items-center justify-between text-sm ${customerId === String(c.id) ? 'bg-primary/5 border-l-2 border-l-primary font-bold' : ''}`}
                    onClick={() => { setCustomerId(String(c.id)); setCustomerSearch(c.name); }}
                  >
                    <span>{c.name}</span>
                    {customerId === String(c.id) && <CheckCircle2 className="h-3.5 w-3.5 text-primary" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Line items */}
          <div className="space-y-2">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <Label>Line Items</Label>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setShowNewProduct(value => !value)}><Plus className="h-3 w-3" /> New product/service</Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={addLine}><Plus className="h-3 w-3" /> Add Row</Button>
              </div>
            </div>
            {showNewProduct && <div className="grid gap-2 rounded-lg border bg-muted/20 p-3 sm:grid-cols-2 xl:grid-cols-4">
              <Input placeholder="Name" value={newProduct.name} onChange={e => setNewProduct(value => ({ ...value, name: e.target.value }))} />
              <Input placeholder="Description" value={newProduct.description} onChange={e => setNewProduct(value => ({ ...value, description: e.target.value }))} />
              <Input type="number" min="0" step="0.01" placeholder="Unit price" value={newProduct.unit_price} onChange={e => setNewProduct(value => ({ ...value, unit_price: e.target.value }))} />
              <Button type="button" onClick={() => void createProduct()} disabled={!newProduct.name.trim() || creatingProduct}>{creatingProduct ? 'Saving…' : 'Save product/service'}</Button>
            </div>}
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="bg-muted/50 text-[10px] font-bold uppercase tracking-widest">
                  <tr>
                    <th className="text-left px-3 py-2">Product / Service</th>
                    <th className="text-left px-3 py-2">Description</th>
                    <th className="text-right px-3 py-2 w-16">Qty</th>
                    <th className="text-right px-3 py-2 w-28">Unit Price</th>
                    <th className="text-right px-3 py-2 w-20">Tax %</th>
                    <th className="text-right px-3 py-2 w-24">Total</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {lines.map((line, i) => (
                    <tr key={i}>
                      <td className="px-2 py-1">
                        <Select value={line.product_id ? String(line.product_id) : '__custom__'} onValueChange={value => selectProduct(i, value)}>
                          <SelectTrigger className="h-8 min-w-40 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent><SelectItem value="__custom__">Custom line</SelectItem>{products.map(product => <SelectItem key={product.id} value={String(product.id)}>{product.name}</SelectItem>)}</SelectContent>
                        </Select>
                      </td>
                      <td className="px-2 py-1">
                        <Input
                          placeholder="Service description…"
                          value={line.description}
                          onChange={e => updateLine(i, 'description', e.target.value)}
                          className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 px-1"
                        />
                      </td>
                      <td className="px-2 py-1">
                        <Input
                          type="number" min="1" value={line.qty}
                          onChange={e => updateLine(i, 'qty', Number(e.target.value))}
                          className="h-7 text-xs text-right border-0 shadow-none focus-visible:ring-0 px-1 w-14"
                        />
                      </td>
                      <td className="px-2 py-1">
                        <Input
                          type="number" min="0" step="0.01" value={line.unit_price}
                          onChange={e => updateLine(i, 'unit_price', Number(e.target.value))}
                          className="h-7 text-xs text-right font-mono border-0 shadow-none focus-visible:ring-0 px-1 w-24"
                        />
                      </td>
                      <td className="px-2 py-1">
                        <Input type="number" min="0" step="0.01" disabled={taxMode === 'combined'} value={line.tax_rate} onChange={e => updateLine(i, 'tax_rate', Number(e.target.value))} className="h-7 w-16 border-0 px-1 text-right text-xs shadow-none focus-visible:ring-0" />
                      </td>
                      <td className="px-3 py-1 text-right font-mono text-xs font-bold">
                        {(line.qty * line.unit_price).toLocaleString('en-KE', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="px-1 py-1">
                        {lines.length > 1 && (
                          <button onClick={() => removeLine(i)} className="text-muted-foreground hover:text-destructive p-1">
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-muted/20 border-t">
                    <td colSpan={5} className="px-3 py-2 text-xs font-bold uppercase tracking-wide text-muted-foreground text-right">Subtotal</td>
                    <td className="px-3 py-2 text-right font-mono font-bold text-sm">{kes(subtotal)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          <div className="rounded-lg border bg-muted/10 p-3 space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1"><Label className="text-xs">Tax method</Label><Select value={taxMode} onValueChange={(value: 'per_line' | 'combined') => setTaxMode(value)}><SelectTrigger className="h-8 w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="per_line">Tax per line</SelectItem><SelectItem value="combined">Combined invoice tax</SelectItem></SelectContent></Select></div>
              {taxMode === 'combined' && <div className="space-y-1"><Label className="text-xs">{settings?.default_tax_name || 'Tax'} rate (%)</Label><Input type="number" min="0" step="0.01" value={combinedTaxRate} onChange={e => setCombinedTaxRate(Number(e.target.value))} className="h-8 w-28" /></div>}
            </div>
            {charges.length > 0 && <div><Label className="text-xs">Additional charges / levies</Label><div className="mt-2 flex flex-wrap gap-2">{charges.filter(charge => charge.is_active).map(charge => <label key={charge.id} className="flex items-center gap-2 rounded border bg-background px-2 py-1 text-xs"><input type="checkbox" checked={chargeIds.includes(charge.id)} onChange={() => setChargeIds(current => current.includes(charge.id) ? current.filter(id => id !== charge.id) : [...current, charge.id])} />{charge.name} ({charge.calculation_type === 'percentage' ? `${charge.rate}%` : kes(Number(charge.rate))})</label>)}</div></div>}
            <div className="grid grid-cols-2 gap-x-5 gap-y-1 border-t pt-2 text-sm sm:grid-cols-4"><span>Subtotal <strong>{kes(subtotal)}</strong></span><span>Tax <strong>{kes(taxTotal)}</strong></span><span>Charges <strong>{kes(chargeTotal)}</strong></span><span className="font-bold">Grand total <strong>{kes(total)}</strong></span></div>
          </div>

          {/* Options */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">Currency</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['KES','USD','EUR','GBP'].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Due Date</Label>
              <Input
                type="date" value={dueDate}
                onChange={e => setDueDate(e.target.value)}
                className="h-8 text-sm"
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Notes</Label>
            <Textarea placeholder="Optional notes…" value={notes} onChange={e => setNotes(e.target.value)} className="h-16 text-sm" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !customerId}>
            {saving ? 'Creating…' : 'Create Invoice'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─────────────────────────────────────────── Debt Tab ── */
function DebtTab({ token }: { token: string | null }) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [consolidating, setConsolidating] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [amountFilter, setAmountFilter] = useState<'all' | 'small' | 'large'>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['debt-summary'],
    queryFn: async () => {
      const res = await fetch('/api/payments/debt/', { headers: { Authorization: `Token ${token}` } });
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    enabled: !!token,
    staleTime: 15_000,
  });

  const debtRows: any[] = data?.results ?? [];
  const filteredRows = debtRows.filter((row: any) => {
    const matchesSearch = !search || [row.customer_name, row.customer_email]
      .filter(Boolean)
      .some((value: string) => value.toLowerCase().includes(search.toLowerCase()));
    const totalOwed = Number(row.total_owed ?? 0);
    const matchesAmount = amountFilter === 'all'
      ? true
      : amountFilter === 'small'
        ? totalOwed < 100000
        : totalOwed >= 100000;
    return matchesSearch && matchesAmount;
  });
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const pagedRows = filteredRows.slice((page - 1) * pageSize, page * pageSize);

  const handleConsolidate = async (customerId: number, customerName: string) => {
    setConsolidating(customerId);
    try {
      const res = await fetch('/api/payments/debt/consolidate/', {
        method: 'POST',
        headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer_id: customerId }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? res.statusText);
      toast({
        title: `Consolidated invoice created for ${customerName}`,
        description: `Invoice ${body.invoice_number} — Share: ${body.share_path}`,
      });
      qc.invalidateQueries({ queryKey: ['invoices'] });
      qc.invalidateQueries({ queryKey: ['debt-summary'] });
      refetch();
      navigate(`/payments/invoices/${body.id}`);
    } catch (err: any) {
      toast({ title: 'Consolidation failed', description: err?.message, variant: 'destructive' });
    } finally {
      setConsolidating(null);
    }
  };

  if (isLoading) return (
    <div className="py-16 text-center text-sm text-muted-foreground animate-pulse">Loading debt summary…</div>
  );

  if (debtRows.length === 0) return (
    <div className="py-16 text-center space-y-3">
      <CheckCircle2 className="h-10 w-10 text-emerald-400 mx-auto" />
      <div className="text-sm text-muted-foreground font-medium">No outstanding debt transactions.</div>
    </div>
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-bold uppercase tracking-widest text-muted-foreground">
          {filteredRows.length} Customer{filteredRows.length !== 1 ? 's' : ''} with Outstanding Debt
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-3">
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search customer…"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                className="pl-9"
              />
            </div>
            <Select value={amountFilter} onValueChange={(value: 'all' | 'small' | 'large') => { setAmountFilter(value); setPage(1); }}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="All Amounts" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Amounts</SelectItem>
                <SelectItem value="small">Below 100,000</SelectItem>
                <SelectItem value="large">100,000 and Above</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Records:</span>
            <Select value={String(pageSize)} onValueChange={(value) => { setPageSize(Number(value)); setPage(1); }}>
              <SelectTrigger className="w-20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[5, 10, 25, 50].map((size) => (
                  <SelectItem key={size} value={String(size)}>{size}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="text-sm text-muted-foreground">
          {filteredRows.length} record{filteredRows.length !== 1 ? 's' : ''} found
        </div>
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableHead className="text-[10px] font-bold uppercase tracking-widest">Customer</TableHead>
              <TableHead className="text-[10px] font-bold uppercase tracking-widest text-right">Transactions</TableHead>
              <TableHead className="text-[10px] font-bold uppercase tracking-widest text-right">Total Owed</TableHead>
              <TableHead className="text-[10px] font-bold uppercase tracking-widest">Oldest Debt</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {pagedRows.map((row: any) => (
              <TableRow key={row.customer_id} className="hover:bg-muted/30">
                <TableCell className="py-2.5">
                  <div className="font-bold text-sm">{row.customer_name}</div>
                  {row.customer_email && <div className="text-xs text-muted-foreground">{row.customer_email}</div>}
                </TableCell>
                <TableCell className="py-2.5 text-right font-mono font-bold">{row.transaction_count}</TableCell>
                <TableCell className="py-2.5 text-right font-mono font-bold text-red-600">
                  {kes(row.total_owed)}
                </TableCell>
                <TableCell className="py-2.5 text-xs text-muted-foreground font-mono">
                  {row.oldest_date ? new Date(row.oldest_date).toLocaleDateString('en-KE') : '—'}
                </TableCell>
                <TableCell className="py-2.5 text-right">
                  <Button
                    size="sm"
                    className="text-xs gap-1.5 bg-primary hover:bg-primary/90"
                    disabled={consolidating === row.customer_id}
                    onClick={() => handleConsolidate(row.customer_id, row.customer_name)}
                  >
                    <Layers className="h-3.5 w-3.5" />
                    {consolidating === row.customer_id ? 'Consolidating…' : 'Consolidate & Share'}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {pagedRows.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-12 text-center text-sm text-muted-foreground">
                  No debt records match your filters.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        {filteredRows.length > 0 && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              Showing {Math.min((page - 1) * pageSize + 1, filteredRows.length)}-{Math.min(page * pageSize, filteredRows.length)} of {filteredRows.length}
            </span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                <ChevronLeft className="h-4 w-4 mr-1" /> Previous
              </Button>
              <span className="text-muted-foreground">Page {page} of {totalPages}</span>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
                Next <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ════════════════════════════════════════════════════════ main page ── */
export default function InvoicesList() {
  const { token } = useAuth();
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const [activeTab, setActiveTab]     = useState<'all' | 'debt'>('all');
  const [statusFilter, setStatusFilter] = useState(() => new URLSearchParams(window.location.search).get('status') || '');
  const [search, setSearch]           = useState('');
  const [page, setPage]               = useState(1);
  const [pageSize, setPageSize]       = useState(10);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [newInvoiceOpen, setNewInvoiceOpen] = useState(false);

  const { data: summary } = useGetPaymentSummary({}, {
    query: { queryKey: getGetPaymentSummaryQueryKey() },
  });

  const { data, isLoading } = useQuery({
    queryKey: ['invoices', statusFilter, search],
    queryFn: async () => {
      const qs = new URLSearchParams();
      if (statusFilter) qs.set('status', statusFilter);
      if (search) qs.set('search', search);
      const res = await fetch(`/api/payments/invoices/?${qs}`, { headers: { Authorization: `Token ${token}` } });
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    enabled: !!token,
    staleTime: 15_000,
  });

  const invoices: any[] = data?.results ?? [];
  const totalCount = data?.count ?? invoices.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const pagedInvoices = invoices.slice((page - 1) * pageSize, page * pageSize);

  const handleExportPayments = useCallback(async () => {
    const res = await fetch('/api/payments/entries/?export=csv', {
      headers: { Authorization: `Token ${token}` },
    });
    if (!res.ok) throw new Error(`${res.status}`);
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = blobUrl;
    anchor.download = 'payments_export.csv';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(blobUrl);
  }, [token]);

  const handleSuccess = useCallback((id: number) => {
    qc.invalidateQueries({ queryKey: ['invoices'] });
    qc.invalidateQueries({ queryKey: getGetPaymentSummaryQueryKey() });
    navigate(`/payments/invoices/${id}`);
  }, [qc, navigate]);

  const statCards = [
    {
      label: 'Total Invoiced',
      value: kes(summary?.total_invoiced),
      icon: <FileText className="h-5 w-5 text-primary" />,
      cls: 'border-l-primary', textCls: '',
    },
    {
      label: 'Collected',
      value: kes(summary?.total_received),
      icon: <DollarSign className="h-5 w-5 text-emerald-500" />,
      cls: 'border-l-emerald-500', textCls: 'text-emerald-600',
    },
    {
      label: 'Outstanding',
      value: kes(summary?.outstanding),
      icon: <AlertCircle className="h-5 w-5 text-orange-500" />,
      cls: 'border-l-orange-500', textCls: 'text-orange-600',
    },
    {
      label: 'Draft',
      value: summary?.invoices_by_status?.find((r: any) => r.status === 'draft')?.count ?? 0,
      icon: <Clock className="h-5 w-5 text-muted-foreground" />,
      cls: 'border-l-muted-foreground', textCls: '', isCount: true,
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 border-b pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <FileText className="h-6 w-6 text-primary" /> Invoices
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">Create invoices, track payment status, and follow customer balances.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 font-bold uppercase tracking-wide text-xs"
            onClick={() => {
              handleExportPayments().catch(() => {});
            }}
          >
            <Download className="h-3.5 w-3.5" /> Export Payments CSV
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 font-bold uppercase tracking-wide text-xs"
            onClick={() => setGenerateOpen(true)}
          >
            <Package className="h-3.5 w-3.5" /> Generate
          </Button>
          <Button
            size="sm"
            className="gap-1.5 font-bold uppercase tracking-wide text-xs"
            onClick={() => setNewInvoiceOpen(true)}
          >
            <Plus className="h-3.5 w-3.5" /> New Invoice
          </Button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {statCards.map(s => (
          <Card key={s.label} className={`border-l-4 ${s.cls} shadow-sm`}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{s.label}</CardTitle>
              {s.icon}
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-black font-mono tracking-tighter ${s.textCls}`}>
                {s.value}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-0 border-b">
        {[
          { key: 'all', label: 'All Invoices', icon: <FileText className="h-3.5 w-3.5" /> },
          { key: 'debt', label: 'Customer Balances', icon: <Users className="h-3.5 w-3.5" /> },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as any)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-bold uppercase tracking-widest border-b-2 transition-colors ${
              activeTab === tab.key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'debt' ? (
        <DebtTab token={token} />
      ) : (
        <>
          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by invoice # or customer…"
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(1); }}
                className="pl-9 bg-card"
              />
            </div>
            <Select value={statusFilter || '__all__'} onValueChange={(value) => { setStatusFilter(value === '__all__' ? '' : value); setPage(1); }}>
              <SelectTrigger className="w-40 bg-card">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All statuses</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="issued">Issued</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
                <SelectItem value="overdue">Overdue</SelectItem>
              </SelectContent>
            </Select>
            <Select value={String(pageSize)} onValueChange={(value) => { setPageSize(Number(value)); setPage(1); }}>
              <SelectTrigger className="w-28 bg-card">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[5, 10, 25, 50].map((size) => (
                  <SelectItem key={size} value={String(size)}>{size} / page</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Table */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-bold uppercase tracking-widest text-muted-foreground">
                {isLoading ? 'Loading…' : `${totalCount} Invoice${totalCount !== 1 ? 's' : ''}`}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead className="text-[10px] font-bold uppercase tracking-widest">Invoice #</TableHead>
                    <TableHead className="text-[10px] font-bold uppercase tracking-widest">Customer</TableHead>
                    <TableHead className="text-[10px] font-bold uppercase tracking-widest">Source</TableHead>
                    <TableHead className="text-[10px] font-bold uppercase tracking-widest">Status</TableHead>
                    <TableHead className="text-[10px] font-bold uppercase tracking-widest text-right">Amount</TableHead>
                    <TableHead className="text-[10px] font-bold uppercase tracking-widest">Issued</TableHead>
                    <TableHead className="text-[10px] font-bold uppercase tracking-widest">Due</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <TableRow key={i}>
                        {Array.from({ length: 8 }).map((_, j) => (
                          <TableCell key={j}><div className="h-4 bg-muted/60 rounded animate-pulse" /></TableCell>
                        ))}
                      </TableRow>
                    ))
                  ) : pagedInvoices.length ? pagedInvoices.map((inv: any) => {
                    const isOverdue = inv.due_date && inv.status === 'issued' && new Date(inv.due_date) < new Date();
                    return (
                      <TableRow
                        key={inv.id}
                        className="hover:bg-muted/30 cursor-pointer transition-colors"
                        onClick={() => navigate(`/payments/invoices/${inv.id}`)}
                      >
                        <TableCell className="py-2.5 font-mono font-bold text-sm text-primary">
                          {inv.invoice_number}
                        </TableCell>
                        <TableCell className="py-2.5 font-bold text-sm">{inv.customer_name}</TableCell>
                        <TableCell className="py-2.5">
                          <SourceBadge module={inv.source_module} />
                        </TableCell>
                        <TableCell className="py-2.5">
                          <StatusBadge s={isOverdue ? 'overdue' : inv.status} />
                        </TableCell>
                        <TableCell className="py-2.5 text-right font-mono font-bold text-sm">
                          {inv.currency} {Number(inv.total_amount || 0).toLocaleString('en-KE', { minimumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell className="py-2.5 text-xs text-muted-foreground font-mono">
                          {inv.issued_at ? new Date(inv.issued_at).toLocaleDateString('en-KE') : inv.created_at ? new Date(inv.created_at).toLocaleDateString('en-KE') : '—'}
                        </TableCell>
                        <TableCell className={`py-2.5 text-xs font-mono ${isOverdue ? 'text-red-600 font-bold' : 'text-muted-foreground'}`}>
                          {inv.due_date ? new Date(inv.due_date).toLocaleDateString('en-KE') : '—'}
                        </TableCell>
                        <TableCell className="py-2.5">
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        </TableCell>
                      </TableRow>
                    );
                  }) : (
                    <TableRow>
                      <TableCell colSpan={8} className="py-16 text-center space-y-3">
                        <FileText className="h-10 w-10 text-muted-foreground/30 mx-auto" />
                        <div className="text-sm text-muted-foreground">
                          {search || statusFilter ? 'No invoices match your filter.' : 'No invoices yet.'}
                        </div>
                        {!search && !statusFilter && (
                          <Button size="sm" onClick={() => setNewInvoiceOpen(true)}>
                            <Plus className="h-3.5 w-3.5 mr-1.5" /> Create Invoice
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          {!isLoading && totalCount > 0 && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                Showing {Math.min((page - 1) * pageSize + 1, totalCount)}-{Math.min(page * pageSize, totalCount)} of {totalCount} invoices
              </span>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                  <ChevronLeft className="h-4 w-4 mr-1" /> Previous
                </Button>
                <span className="text-muted-foreground">Page {page} of {totalPages}</span>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
                  Next <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      <GenerateInvoiceDialog
        open={generateOpen}
        onOpenChange={setGenerateOpen}
        token={token}
        onSuccess={handleSuccess}
      />
      <NewInvoiceDialog
        open={newInvoiceOpen}
        onOpenChange={setNewInvoiceOpen}
        token={token}
        onSuccess={handleSuccess}
      />
    </div>
  );
}
