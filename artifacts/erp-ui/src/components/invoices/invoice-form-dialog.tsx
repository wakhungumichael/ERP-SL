/* Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu. */
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Plus, Search, X } from 'lucide-react';
import { useAuth } from '@/context/use-auth';
import { useToast } from '@/hooks/use-toast';
import { hasPermission } from '@/lib/permissions';
import { formatApiError } from '@/lib/api-errors';
import { invoiceTotals } from '@/lib/invoice-totals';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

/* ─────────────────────────────────────────── New (Manual) Invoice dialog ── */
const emptyBillingDetails = () => ({ billing_address: '', billing_contact_name: '', billing_email: '', billing_phone: '', customer_tax_number: '', customer_reference: '' });
type BillingDetails = ReturnType<typeof emptyBillingDetails>;

export interface EditableInvoice extends Partial<BillingDetails> {
  id: number;
  invoice_number: string;
  customer: number;
  customer_name: string;
  tenant?: number | null;
  currency: string;
  invoice_date: string;
  due_date: string | null;
  notes: string;
  can_edit_items: boolean;
  lines: { product: number | null; product_name: string; description: string; quantity: number | string; unit_price: number; tax_rate: number }[];
  tax_mode: 'per_line' | 'combined';
  combined_tax_rate: number;
  prices_include_tax?: boolean;
  charges: { id: number; charge_rule: number | null; name: string; calculation_type: string; rate: number; amount: number }[];
}

interface InvoiceFormDialogProps {
  invoice?: EditableInvoice;
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

function todayForDateInput() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
}

export function InvoiceFormDialog({ open, onOpenChange, token, onSuccess, invoice }: InvoiceFormDialogProps) {
  const { toast } = useToast();
  const editing = Boolean(invoice);
  const editableItems = !invoice || invoice.can_edit_items;
  const { user } = useAuth();
  const qc = useQueryClient();
  const canAddCustomer = hasPermission(user as any, 'SL_Sales.add_salescustomer');
  const tenantId = invoice?.tenant ?? (user as any)?.organization_id ?? (user as any)?.tenant_id;
  const [customerId, setCustomerId] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [newCustomer, setNewCustomer] = useState({ name: '', phone_number: '', email: '', address: '' });
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [creatingCustomer, setCreatingCustomer] = useState(false);
  const [currency, setCurrency] = useState('KES');
  const [invoiceDate, setInvoiceDate] = useState(todayForDateInput);
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [billingDetails, setBillingDetails] = useState(emptyBillingDetails);
  const [lines, setLines] = useState<LineItem[]>([{ product_id: null, description: '', qty: 1, unit_price: 0, tax_rate: 0 }]);
  const [taxMode, setTaxMode] = useState<'per_line' | 'combined'>('per_line');
  const [combinedTaxRate, setCombinedTaxRate] = useState(0);
  const [pricesIncludeTax, setPricesIncludeTax] = useState(false);
  const [chargeIds, setChargeIds] = useState<number[]>([]);
  const [newProduct, setNewProduct] = useState({ name: '', description: '', unit_price: '', product_type: 'service' });
  const [showNewProduct, setShowNewProduct] = useState(false);
  const [creatingProduct, setCreatingProduct] = useState(false);
  const [saving, setSaving] = useState(false);
  const initializedInvoice = useRef<number | null>(null);

  const { data: customersData, isLoading: customersLoading, isError: customersError, refetch: refetchCustomers } = useQuery({
    queryKey: ['invoice-customers-new', token, customerSearch],
    queryFn: async () => {
      const qs = customerSearch ? `?search=${encodeURIComponent(customerSearch)}` : '';
      const res = await fetch(`/api/payments/customers/${qs}`, { headers: { Authorization: `Token ${token}` } });
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    enabled: !!token && open && editableItems,
    staleTime: 15_000,
  });

  const customers: any[] = customersData?.results ?? [];
  const { data: productsData } = useQuery({
    queryKey: ['invoice-products-new', token],
    queryFn: async () => {
      const res = await fetch('/api/sales/products/?is_active=true&page_size=100', { headers: { Authorization: `Token ${token}` } });
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    enabled: !!token && open && editableItems,
  });
  const products: any[] = [...(productsData?.results ?? productsData ?? [])];
  for (const line of invoice?.lines ?? []) {
    if (line.product && !products.some(product => product.id === line.product)) products.push({ id: line.product, name: line.product_name, description: line.description, unit_price: line.unit_price, tax_rate: line.tax_rate });
  }
  const { data: settingsData } = useQuery({ queryKey: ['invoice-tax-settings', tenantId], queryFn: async () => (await fetch(`/api/platform/tenants/${tenantId}/settings/`, { headers: { Authorization: `Token ${token}` } })).json(), enabled: !!token && !!tenantId && open && editableItems });
  const settings = settingsData?.data ?? settingsData ?? {};
  const { data: chargesData } = useQuery({ queryKey: ['invoice-charges'], queryFn: async () => (await fetch('/api/sales/charges/', { headers: { Authorization: `Token ${token}` } })).json(), enabled: !!token && open });
  const chargeOptions = new Map<number, any>((chargesData?.results ?? chargesData ?? []).filter((charge: any) => !charge.applies_to || ['invoice', 'both'].includes(charge.applies_to)).map((charge: any) => [charge.id, charge]));
  for (const charge of invoice?.charges ?? []) {
    const key = charge.charge_rule ?? -charge.id;
    chargeOptions.set(key, { ...charge, id: key, is_active: true });
  }
  const charges: any[] = [...chargeOptions.values()];

  useEffect(() => {
    if (!open || !invoice) {
      if (open && !invoice) setInvoiceDate(todayForDateInput());
      initializedInvoice.current = null;
      return;
    }
    if (initializedInvoice.current === invoice.id) return;
    initializedInvoice.current = invoice.id;
    setCustomerId(String(invoice.customer));
    setCustomerSearch(invoice.customer_name);
    qc.setQueryData(['invoice-customers-new', token, invoice.customer_name], { results: [{ id: invoice.customer, name: invoice.customer_name }] });
    setCurrency(invoice.currency);
    setInvoiceDate(invoice.invoice_date || todayForDateInput());
    setDueDate(invoice.due_date ?? '');
    setNotes(invoice.notes ?? '');
    setBillingDetails(Object.fromEntries(Object.keys(emptyBillingDetails()).map(key => [key, invoice[key as keyof BillingDetails] ?? ''])) as BillingDetails);
    setLines(invoice.lines.map(line => ({ product_id: line.product, description: line.description, qty: Number(line.quantity), unit_price: Number(line.unit_price), tax_rate: Number(line.tax_rate) })));
    setTaxMode(invoice.tax_mode);
    setCombinedTaxRate(Number(invoice.combined_tax_rate));
    setPricesIncludeTax(Boolean(invoice.prices_include_tax));
    setChargeIds(invoice.charges.map(charge => charge.charge_rule ?? -charge.id));
    setShowNewCustomer(false);
    setShowNewProduct(false);
  }, [open, invoice, token, qc]);
  const { subtotal, taxTotal, chargeTotal, total } = invoiceTotals(
    lines, taxMode, combinedTaxRate, pricesIncludeTax, charges.filter(charge => chargeIds.includes(charge.id)),
  );

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
  const selectCustomer = (customer: any) => {
    setCustomerId(String(customer.id));
    setCustomerSearch(customer.name);
    if (String(customer.id) !== customerId) setBillingDetails({ ...emptyBillingDetails(), billing_address: customer.address || '', billing_email: customer.email || '', billing_phone: customer.phone || customer.phone_number || '' });
  };
  const createCustomer = async () => {
    const name = newCustomer.name.trim();
    const phone = newCustomer.phone_number.trim();
    if (!name || !phone) {
      toast({ title: 'Enter a customer name and phone number', variant: 'destructive' });
      return;
    }
    setCreatingCustomer(true);
    try {
      const response = await fetch('/api/sales/customers/', {
        method: 'POST',
        headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...newCustomer, name, phone_number: phone, email: newCustomer.email.trim() || null }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const firstError = Object.values(body).flat().find(Boolean);
        throw new Error(typeof body.detail === 'string' ? body.detail : typeof body.error === 'string' ? body.error : typeof firstError === 'string' ? firstError : 'Customer could not be created.');
      }
      selectCustomer(body);
      qc.setQueryData(['invoice-customers-new', token, body.name], { results: [{ ...body, phone: body.phone_number }] });
      for (const key of ['invoice-customers-new', 'invoice-customers', 'sales-customers', 'estimate-customers', 'sales-order-customers', 'statement-customers']) {
        void qc.invalidateQueries({ queryKey: [key] });
      }
      setShowNewCustomer(false);
      setNewCustomer({ name: '', phone_number: '', email: '', address: '' });
      toast({ title: 'Customer created', description: `${body.name} has been selected for this invoice.` });
    } catch (error: any) {
      toast({ title: 'Could not save customer', description: error.message, variant: 'destructive' });
    } finally {
      setCreatingCustomer(false);
    }
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
      qc.setQueryData(['invoice-products-new', token], (current: any) => {
        const items = current?.results ?? current ?? [];
        const updated = [...items.filter((item: any) => item.id !== body.id), body];
        return Array.isArray(current) ? updated : { ...current, results: updated };
      });
      for (const key of ['products', 'purchases-products', 'estimate-products', 'sales-order-products']) {
        void qc.invalidateQueries({ queryKey: [key] });
      }
      setLines(prev => {
        const item = { product_id: body.id, description: body.description || body.name, qty: 1, unit_price: Number(body.unit_price), tax_rate: Number(body.tax_rate ?? 0) };
        const emptyIndex = prev.findIndex(line => !line.product_id && !line.description.trim() && line.unit_price === 0);
        return emptyIndex < 0 ? [...prev, item] : prev.map((line, index) => index === emptyIndex ? item : line);
      });
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
    if (editableItems && !customerId) { toast({ title: 'Select a customer', variant: 'destructive' }); return; }
    if (editableItems && lines.every(l => !l.description)) { toast({ title: 'Add at least one line item', variant: 'destructive' }); return; }

    const financialPayload = {
      customer_id: parseInt(customerId),
      line_items: lines.filter(line => line.description),
      currency,
      tax_mode: taxMode,
      combined_tax_rate: combinedTaxRate,
      prices_include_tax: pricesIncludeTax,
      charge_ids: [...chargeIds].sort((a, b) => a - b),
    };
    const financialChanges = editableItems && (!invoice || JSON.stringify(financialPayload) !== JSON.stringify({
      customer_id: invoice.customer,
      line_items: invoice.lines.filter(line => line.description).map(line => ({ product_id: line.product, description: line.description, qty: Number(line.quantity), unit_price: Number(line.unit_price), tax_rate: Number(line.tax_rate) })),
      currency: invoice.currency,
      tax_mode: invoice.tax_mode,
      combined_tax_rate: Number(invoice.combined_tax_rate),
      prices_include_tax: Boolean(invoice.prices_include_tax),
      charge_ids: invoice.charges.map(charge => charge.charge_rule ?? -charge.id).sort((a, b) => a - b),
    }));
    setSaving(true);
    try {
      const res = await fetch(invoice ? `/api/payments/invoices/${invoice.id}/` : '/api/payments/invoices/', {
        method: editing ? 'PATCH' : 'POST',
        headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notes,
          ...billingDetails,
          invoice_date: invoiceDate,
          due_date: dueDate || (editing ? null : undefined),
          ...(!editing ? { source_module: 'manual' } : {}),
          ...(financialChanges ? financialPayload : {}),
        }),
      });
      const contentType = res.headers.get('content-type') ?? '';
      const body = contentType.includes('application/json')
        ? await res.json().catch(() => ({}))
        : { error: `The invoice service returned an unexpected response (${res.status}). Please try again or contact an administrator.` };
      if (!res.ok) {
        throw new Error(formatApiError(body, 'The invoice could not be saved. Please check the form and try again.'));
      }
      const inv = body;
      toast({ title: `Invoice ${inv.invoice_number} ${editing ? 'updated' : 'created'}` });
      onSuccess(inv.id);
      if (!editing) reset();
      onOpenChange(false);
    } catch (e: any) {
      toast({ title: editing ? 'Error updating invoice' : 'Error creating invoice', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setCustomerId(''); setCustomerSearch(''); setCurrency('KES');
    setShowNewCustomer(false); setNewCustomer({ name: '', phone_number: '', email: '', address: '' });
    setShowNewProduct(false); setNewProduct({ name: '', description: '', unit_price: '', product_type: 'service' });
    setInvoiceDate(todayForDateInput()); setDueDate(''); setNotes(''); setBillingDetails(emptyBillingDetails());
    setLines([{ product_id: null, description: '', qty: 1, unit_price: 0, tax_rate: Number(settings?.default_tax_rate ?? 0) }]);
    setPricesIncludeTax(false);
    setTaxMode('per_line'); setCombinedTaxRate(Number(settings?.default_tax_rate ?? 0)); setChargeIds([]);
  };

  const billingFields = (
    <details className="min-w-0 rounded-lg border bg-muted/10 p-4" open>
      <summary className="cursor-pointer text-sm font-semibold">Billing details</summary>
      <p className="mt-2 text-xs text-muted-foreground">These details appear on this invoice. The customer record stays unchanged.</p>
      <div className="mt-4 grid min-w-0 gap-4 sm:grid-cols-2">
        <div className="min-w-0 space-y-1.5 sm:col-span-2"><Label htmlFor="invoice-billing-address">Client postal / physical address</Label><Textarea id="invoice-billing-address" rows={3} maxLength={3000} value={billingDetails.billing_address} onChange={e => setBillingDetails(value => ({ ...value, billing_address: e.target.value }))} placeholder="Street or building, postal address, city and country" /></div>
        <div className="min-w-0 space-y-1.5"><Label htmlFor="invoice-billing-contact">Contact person / attention</Label><Input id="invoice-billing-contact" maxLength={150} value={billingDetails.billing_contact_name} onChange={e => setBillingDetails(value => ({ ...value, billing_contact_name: e.target.value }))} /></div>
        <div className="min-w-0 space-y-1.5"><Label htmlFor="invoice-customer-tax">Client tax ID / PIN</Label><Input id="invoice-customer-tax" maxLength={80} value={billingDetails.customer_tax_number} onChange={e => setBillingDetails(value => ({ ...value, customer_tax_number: e.target.value }))} /></div>
        <div className="min-w-0 space-y-1.5"><Label htmlFor="invoice-billing-email">Billing email</Label><Input id="invoice-billing-email" type="email" maxLength={255} value={billingDetails.billing_email} onChange={e => setBillingDetails(value => ({ ...value, billing_email: e.target.value }))} /></div>
        <div className="min-w-0 space-y-1.5"><Label htmlFor="invoice-billing-phone">Billing phone</Label><Input id="invoice-billing-phone" type="tel" maxLength={50} value={billingDetails.billing_phone} onChange={e => setBillingDetails(value => ({ ...value, billing_phone: e.target.value }))} /></div>
        <div className="min-w-0 space-y-1.5 sm:col-span-2"><Label htmlFor="invoice-customer-reference">Purchase order / contract reference</Label><Input id="invoice-customer-reference" maxLength={150} value={billingDetails.customer_reference} onChange={e => setBillingDetails(value => ({ ...value, customer_reference: e.target.value }))} /></div>
      </div>
    </details>
  );

  if (invoice && !editableItems) return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[100dvh] max-h-[100dvh] w-full flex-col gap-0 overflow-hidden rounded-none border-0 p-0 sm:h-auto sm:max-h-[94dvh] sm:w-[calc(100vw-2rem)] sm:max-w-lg sm:rounded-lg sm:border">
        <DialogHeader className="shrink-0 border-b px-4 py-5 pr-12 sm:px-6 sm:pr-12"><DialogTitle>Edit {invoice.invoice_number}</DialogTitle></DialogHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-y-contain px-4 py-5 sm:px-6">
          {billingFields}
          <p className="text-sm text-muted-foreground">Update billing details, the invoice date, due date, and notes. Customer, currency, items, tax, and charges can be changed on draft manual invoices.</p>
          <div className="min-w-0 space-y-1.5"><Label htmlFor="edit-invoice-date">Invoice date</Label><Input id="edit-invoice-date" type="date" required className="h-11 w-full min-w-0 text-base" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} /><p className="text-xs text-muted-foreground">Choose an earlier date to backdate this invoice.</p></div>
          <div className="min-w-0 space-y-1.5"><Label htmlFor="edit-invoice-due-date">Due date</Label><Input id="edit-invoice-due-date" type="date" className="h-11 w-full min-w-0 text-base" value={dueDate} onChange={e => setDueDate(e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="edit-invoice-notes">Notes</Label><Textarea id="edit-invoice-notes" className="min-h-28 text-base" value={notes} onChange={e => setNotes(e.target.value)} /></div>
        </div>
        <DialogFooter className="shrink-0 gap-2 border-t px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-4 [&_button]:min-h-11"><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={handleSave} disabled={saving || !invoiceDate}>{saving ? 'Saving...' : 'Save changes'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="flex h-[100dvh] max-h-[100dvh] w-full max-w-7xl flex-col gap-0 overflow-hidden rounded-none border-0 p-0 sm:h-auto sm:max-h-[94dvh] sm:w-[calc(100vw-3rem)] sm:rounded-lg sm:border">
        <DialogHeader className="shrink-0 border-b px-4 py-5 pr-12 sm:px-6 sm:pr-12">
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-4 w-4" /> {invoice ? `Edit ${invoice.invoice_number}` : 'New Invoice'}
          </DialogTitle>
        </DialogHeader>

        <div className="min-h-0 min-w-0 flex-1 space-y-6 overflow-y-auto overscroll-y-contain px-4 py-5 sm:px-6 [&_input]:h-11 [&_input]:min-w-0 [&_input]:text-base md:[&_input]:h-9 md:[&_input]:text-sm [&_button[role=combobox]]:h-11 [&_button[role=combobox]]:min-w-0 [&_button[role=combobox]]:text-base md:[&_button[role=combobox]]:h-9 md:[&_button[role=combobox]]:text-sm">
          <section aria-label="Invoice dates" className="grid min-w-0 gap-4 rounded-lg border bg-muted/20 p-4 sm:grid-cols-2">
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="invoice-date">Invoice date</Label>
              <Input id="invoice-date" className="w-full max-w-full" type="date" required value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} />
              <p className="text-xs text-muted-foreground">Use the date on the original invoice, including dates from previous years.</p>
            </div>
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="invoice-due-date">Due date</Label>
              <Input id="invoice-due-date" className="w-full max-w-full" type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
              <p className="text-xs text-muted-foreground">Leave blank to calculate it from the invoice date and payment terms.</p>
            </div>
          </section>

          {/* Customer picker */}
          <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Label htmlFor="invoice-customer-search">Customer</Label>
              {canAddCustomer && <Button type="button" size="sm" variant="outline" className="min-h-11 gap-1.5 sm:min-h-9" disabled={creatingCustomer} onClick={() => {
                if (!showNewCustomer) setNewCustomer(value => ({ ...value, name: customerSearch }));
                setShowNewCustomer(value => !value);
              }}><Plus className="h-3.5 w-3.5" /> Add customer</Button>}
            </div>
            {showNewCustomer && <form className="space-y-3 rounded-lg border bg-muted/20 p-4" onSubmit={e => { e.preventDefault(); void createCustomer(); }}>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1"><Label htmlFor="invoice-new-customer-name">Customer name *</Label><Input id="invoice-new-customer-name" required maxLength={255} value={newCustomer.name} disabled={creatingCustomer} onChange={e => setNewCustomer(value => ({ ...value, name: e.target.value }))} /></div>
                <div className="space-y-1"><Label htmlFor="invoice-new-customer-phone">Phone number *</Label><Input id="invoice-new-customer-phone" type="tel" required maxLength={20} value={newCustomer.phone_number} disabled={creatingCustomer} onChange={e => setNewCustomer(value => ({ ...value, phone_number: e.target.value }))} /></div>
                <div className="space-y-1"><Label htmlFor="invoice-new-customer-email">Email</Label><Input id="invoice-new-customer-email" type="email" maxLength={255} value={newCustomer.email} disabled={creatingCustomer} onChange={e => setNewCustomer(value => ({ ...value, email: e.target.value }))} /></div>
                <div className="space-y-1"><Label htmlFor="invoice-new-customer-address">Address</Label><Input id="invoice-new-customer-address" value={newCustomer.address} disabled={creatingCustomer} onChange={e => setNewCustomer(value => ({ ...value, address: e.target.value }))} /></div>
              </div>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end [&_button]:min-h-11 sm:[&_button]:min-h-9">
                <Button type="button" variant="ghost" disabled={creatingCustomer} onClick={() => setShowNewCustomer(false)}>Cancel</Button>
                <Button type="submit" disabled={creatingCustomer || !newCustomer.name.trim() || !newCustomer.phone_number.trim()}>{creatingCustomer ? 'Saving customer...' : 'Save customer'}</Button>
              </div>
            </form>}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                id="invoice-customer-search"
                placeholder="Search customer…"
                value={customerSearch}
                onChange={e => { setCustomerSearch(e.target.value); setCustomerId(''); }}
                className="pl-9"
              />
            </div>
            {customersLoading ? <p className="py-3 text-sm text-muted-foreground">Loading customers...</p> : customersError ? <div className="flex items-center gap-2 py-3 text-sm text-destructive">Could not load customers.<Button size="sm" variant="ghost" onClick={() => void refetchCustomers()}>Retry</Button></div> : customers.length === 0 ? <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No customers found.{canAddCustomer ? ' Use Add customer above to create one.' : ''}</p> : null}
            {customers.length > 0 && (
              <div className="border rounded-lg divide-y max-h-36 overflow-y-auto">
                {customers.slice(0, 8).map((c: any) => (
                  <button
                    key={c.id}
                    className={`min-h-11 w-full gap-3 px-4 py-3 text-left text-sm transition-colors hover:bg-muted/50 flex items-center justify-between ${customerId === String(c.id) ? 'bg-primary/5 border-l-2 border-l-primary font-bold' : ''}`}
                    onClick={() => selectCustomer(c)}
                  >
                    <span className="min-w-0 break-words">{c.name}</span>
                    {customerId === String(c.id) && <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {billingFields}

          {/* Line items */}
          <div className="min-w-0 space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <Label>Line Items</Label>
              <div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-2 sm:flex sm:flex-wrap">
                <Button size="sm" variant="outline" className="min-h-11 gap-1.5 px-2 text-xs sm:min-h-9 sm:px-3" onClick={() => setShowNewProduct(value => !value)}><Plus className="h-3 w-3" /> New product/service</Button>
                <Button size="sm" variant="ghost" className="min-h-11 gap-1.5 text-xs sm:min-h-9" onClick={addLine}><Plus className="h-3 w-3" /> Add Row</Button>
              </div>
            </div>
            {showNewProduct && (
              <div className="grid min-w-0 gap-4 rounded-lg border bg-muted/20 p-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="min-w-0 space-y-1.5">
                  <Label htmlFor="invoice-product-type">Type</Label>
                  <Select value={newProduct.product_type} disabled={creatingProduct} onValueChange={product_type => setNewProduct(value => ({ ...value, product_type }))}>
                    <SelectTrigger id="invoice-product-type"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="product">Product</SelectItem><SelectItem value="service">Service</SelectItem></SelectContent>
                  </Select>
                </div>
                <div className="min-w-0 space-y-1.5 sm:col-span-1 lg:col-span-2">
                  <Label htmlFor="invoice-product-name">Name</Label>
                  <Input id="invoice-product-name" disabled={creatingProduct} placeholder="Product or service name" value={newProduct.name} onChange={e => setNewProduct(value => ({ ...value, name: e.target.value }))} />
                </div>
                <div className="min-w-0 space-y-1.5">
                  <Label htmlFor="invoice-product-price">Unit price</Label>
                  <Input id="invoice-product-price" disabled={creatingProduct} type="number" inputMode="decimal" min="0" step="0.01" placeholder="0.00" value={newProduct.unit_price} onChange={e => setNewProduct(value => ({ ...value, unit_price: e.target.value }))} />
                </div>
                <div className="min-w-0 space-y-1.5 sm:col-span-2 lg:col-span-4">
                  <Label htmlFor="invoice-product-description">Description</Label>
                  <Input id="invoice-product-description" disabled={creatingProduct} placeholder="Product or service description" value={newProduct.description} onChange={e => setNewProduct(value => ({ ...value, description: e.target.value }))} />
                </div>
                <div className="flex flex-col-reverse gap-2 sm:col-span-2 sm:flex-row sm:justify-end lg:col-span-4">
                  <Button type="button" variant="ghost" className="min-h-11 sm:min-h-9" disabled={creatingProduct} onClick={() => setShowNewProduct(false)}>Cancel</Button>
                  <Button type="button" className="min-h-11 sm:min-h-9" onClick={() => void createProduct()} disabled={!newProduct.name.trim() || creatingProduct}>{creatingProduct ? 'Saving...' : 'Save product/service'}</Button>
                </div>
              </div>
            )}
            <div className="min-w-0 space-y-3 lg:space-y-0 lg:overflow-hidden lg:rounded-lg lg:border">
              <div aria-hidden="true" className="hidden gap-3 bg-muted/50 px-4 py-3 text-xs font-semibold lg:grid lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1.6fr)_4rem_6rem_4rem_7rem_2.75rem]">
                <span>Product / Service</span><span>Description</span><span>Qty</span><span>Unit price{pricesIncludeTax ? " (incl. tax)" : ""}</span><span>Tax %</span><span className="text-right">Total{pricesIncludeTax ? " (incl. tax)" : ""}</span><span />
              </div>
              {lines.map((line, i) => (
                <div key={i} role="group" aria-label={`Invoice line ${i + 1}`} className="grid min-w-0 grid-cols-2 items-end gap-4 rounded-lg border bg-background p-4 sm:grid-cols-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1.6fr)_4rem_6rem_4rem_7rem_2.75rem] lg:gap-3 lg:rounded-none lg:border-0 lg:border-t">
                  <div className="col-span-2 min-w-0 space-y-1.5 lg:col-span-1">
                    <Label htmlFor={`invoice-line-${i}-product`} className="lg:sr-only">Product / Service</Label>
                    <Select value={line.product_id ? String(line.product_id) : '__custom__'} onValueChange={value => selectProduct(i, value)}>
                      <SelectTrigger id={`invoice-line-${i}-product`} className="w-full min-w-0 [&>span]:truncate"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="__custom__">Custom line</SelectItem>{products.map(product => <SelectItem key={product.id} value={String(product.id)}>{product.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-2 min-w-0 space-y-1.5 lg:col-span-1">
                    <Label htmlFor={`invoice-line-${i}-description`} className="lg:sr-only">Description</Label>
                    <Input id={`invoice-line-${i}-description`} placeholder="Item description" value={line.description} onChange={e => updateLine(i, 'description', e.target.value)} />
                  </div>
                  <div className="min-w-0 space-y-1.5">
                    <Label htmlFor={`invoice-line-${i}-qty`} className="lg:sr-only">Quantity</Label>
                    <Input id={`invoice-line-${i}-qty`} type="number" inputMode="decimal" min="0.001" step="0.001" value={line.qty} onChange={e => updateLine(i, 'qty', Number(e.target.value))} />
                  </div>
                  <div className="min-w-0 space-y-1.5">
                    <Label htmlFor={`invoice-line-${i}-price`} className="lg:sr-only">Unit price{pricesIncludeTax ? " (incl. tax)" : ""}</Label>
                    <Input id={`invoice-line-${i}-price`} type="number" inputMode="decimal" min="0" step="0.01" value={line.unit_price} onChange={e => updateLine(i, 'unit_price', Number(e.target.value))} />
                  </div>
                  <div className="min-w-0 space-y-1.5">
                    <Label htmlFor={`invoice-line-${i}-tax`} className="lg:sr-only">Tax %</Label>
                    <Input id={`invoice-line-${i}-tax`} type="number" inputMode="decimal" min="0" step="0.01" disabled={taxMode === 'combined'} value={line.tax_rate} onChange={e => updateLine(i, 'tax_rate', Number(e.target.value))} />
                  </div>
                  <div className="min-w-0 space-y-1.5 text-right">
                    <span className="text-sm font-medium lg:sr-only">Total{pricesIncludeTax ? " (incl. tax)" : ""}</span>
                    <div className="flex min-h-11 items-center justify-end break-all font-mono text-sm font-semibold md:min-h-9">{(line.qty * line.unit_price).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                  </div>
                  <div className="col-span-2 flex justify-end sm:col-span-4 lg:col-span-1 lg:min-h-9">
                    {lines.length > 1 && <Button type="button" variant="ghost" className="min-h-11 gap-1.5 px-2 text-muted-foreground hover:text-destructive lg:h-9 lg:min-h-9 lg:w-11" aria-label={`Remove invoice line ${i + 1}`} onClick={() => removeLine(i)}><X className="h-4 w-4" /><span className="lg:sr-only">Remove item</span></Button>}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.8fr)] lg:items-start">
            <div className="min-w-0 space-y-5">
              <div className="grid min-w-0 gap-4 sm:grid-cols-2">
                <div className="min-w-0 space-y-1.5">
                  <Label htmlFor="invoice-currency">Currency</Label>
                  <Select value={currency} onValueChange={setCurrency}>
                    <SelectTrigger id="invoice-currency"><SelectValue /></SelectTrigger>
                    <SelectContent>{['KES', 'USD', 'EUR', 'GBP'].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="min-w-0 space-y-1.5">
                  <Label htmlFor="invoice-tax-method">Tax method</Label>
                  <Select value={taxMode} onValueChange={(value: 'per_line' | 'combined') => { setTaxMode(value); if (value !== 'combined') setPricesIncludeTax(false); }}>
                    <SelectTrigger id="invoice-tax-method"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="per_line">Tax per line</SelectItem><SelectItem value="combined">Combined invoice tax</SelectItem></SelectContent>
                  </Select>
                </div>
                {taxMode === 'combined' && <>
                  <div className="min-w-0 space-y-1.5"><Label htmlFor="invoice-tax-rate">{settings?.default_tax_name || 'Tax'} rate (%)</Label><Input id="invoice-tax-rate" type="number" inputMode="decimal" min="0" max="999.99" step="0.01" value={combinedTaxRate} onChange={e => setCombinedTaxRate(Number(e.target.value))} /></div>
                  <div className="min-w-0 space-y-1.5">
                    <Label htmlFor="invoice-tax-treatment">Tax treatment</Label>
                    <Select value={pricesIncludeTax ? 'inclusive' : 'exclusive'} onValueChange={value => setPricesIncludeTax(value === 'inclusive')}>
                      <SelectTrigger id="invoice-tax-treatment"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="exclusive">Prices exclude tax</SelectItem><SelectItem value="inclusive">Prices include tax</SelectItem></SelectContent>
                    </Select>
                  </div>
                  {pricesIncludeTax && <p className="text-sm text-muted-foreground sm:col-span-2">Enter prices including tax. Tax is extracted from the item total; additional charges are added separately.</p>}
                </>}
              </div>
              {charges.some(charge => charge.is_active) && <fieldset className="min-w-0 space-y-2"><legend className="text-sm font-medium">Additional charges / levies</legend><div className="grid gap-2">{charges.filter(charge => charge.is_active).map(charge => <label key={charge.id} className="flex min-h-11 min-w-0 cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm"><input type="checkbox" className="!h-4 w-4 shrink-0" checked={chargeIds.includes(charge.id)} onChange={() => setChargeIds(current => current.includes(charge.id) ? current.filter(id => id !== charge.id) : [...current, charge.id])} /><span className="min-w-0 break-words">{charge.name} ({charge.calculation_type === 'percentage' ? `${charge.rate}%` : `${currency} ${Number(charge.rate).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`})</span></label>)}</div></fieldset>}
              <div className="space-y-1.5">
                <Label htmlFor="invoice-notes">Notes</Label>
                <Textarea id="invoice-notes" placeholder="Optional notes..." value={notes} onChange={e => setNotes(e.target.value)} className="min-h-24 text-base md:text-sm" />
              </div>
            </div>
            <div className="min-w-0 rounded-lg border bg-muted/20 p-4 sm:p-5">
              <h3 className="mb-4 text-sm font-semibold">Invoice summary</h3>
              <dl className="space-y-3 text-sm">
                {[[pricesIncludeTax ? 'Subtotal (excl. tax)' : 'Subtotal', subtotal], [pricesIncludeTax ? 'Tax included' : 'Tax', taxTotal], ['Charges', chargeTotal]].map(([label, amount]) => <div key={label} className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-4"><dt className="text-muted-foreground">{label}</dt><dd className="break-all text-right font-mono font-medium">{currency} {Number(amount).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</dd></div>)}
                <div className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-4 border-t pt-4 font-semibold"><dt>Grand total</dt><dd className="break-all text-right font-mono text-lg">{currency} {total.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</dd></div>
              </dl>
            </div>
          </div>
        </div>

        <DialogFooter className="shrink-0 gap-2 border-t bg-background px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-4 [&_button]:min-h-11 sm:[&_button]:min-h-9">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || creatingCustomer || creatingProduct || !customerId || !invoiceDate}>
            {saving ? (editing ? 'Saving...' : 'Creating...') : (editing ? 'Save changes' : 'Create Invoice')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
