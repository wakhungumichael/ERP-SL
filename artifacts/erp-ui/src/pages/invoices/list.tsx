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
  CheckCircle2, Clock, Package, X, ArrowRight,
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
  // legacy compat
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
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
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

/* ════════════════════════════════════════════════════════ main page ── */
export default function InvoicesList() {
  const { token } = useAuth();
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [generateOpen, setGenerateOpen] = useState(false);

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

  const handleGenerateSuccess = useCallback((id: number) => {
    qc.invalidateQueries({ queryKey: ['invoices'] });
    qc.invalidateQueries({ queryKey: getGetPaymentSummaryQueryKey() });
    navigate(`/payments/invoices/${id}`);
  }, [qc, navigate]);

  const statCards = [
    {
      label: 'Total Invoiced',
      value: kes(summary?.total_invoiced),
      icon: <FileText className="h-5 w-5 text-primary" />,
      cls: 'border-l-primary',
      textCls: '',
    },
    {
      label: 'Collected',
      value: kes(summary?.total_received),
      icon: <DollarSign className="h-5 w-5 text-emerald-500" />,
      cls: 'border-l-emerald-500',
      textCls: 'text-emerald-600',
    },
    {
      label: 'Outstanding',
      value: kes(summary?.outstanding),
      icon: <AlertCircle className="h-5 w-5 text-orange-500" />,
      cls: 'border-l-orange-500',
      textCls: 'text-orange-600',
    },
    {
      label: 'Draft',
      value: summary?.invoices_by_status?.find((r: any) => r.status === 'draft')?.count ?? 0,
      icon: <Clock className="h-5 w-5 text-muted-foreground" />,
      cls: 'border-l-muted-foreground',
      textCls: '',
      isCount: true,
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
          <p className="text-sm text-muted-foreground mt-0.5">Financial ledger and billing</p>
        </div>
        <Button
          size="sm"
          className="gap-1.5 font-bold uppercase tracking-wide text-xs"
          onClick={() => setGenerateOpen(true)}
        >
          <Plus className="h-3.5 w-3.5" /> Generate Invoice
        </Button>
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
                {s.isCount ? s.value : s.value}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by invoice # or customer…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 bg-card"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40 bg-card">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">All statuses</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="issued">Issued</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
            <SelectItem value="overdue">Overdue</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold uppercase tracking-widest text-muted-foreground">
            {isLoading ? 'Loading…' : `${invoices.length} Invoice${invoices.length !== 1 ? 's' : ''}`}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead className="text-[10px] font-bold uppercase tracking-widest">Invoice #</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-widest">Customer</TableHead>
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
                    {Array.from({ length: 7 }).map((_, j) => (
                      <TableCell key={j}><div className="h-4 bg-muted/60 rounded animate-pulse" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : invoices.length ? invoices.map((inv: any) => {
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
                  <TableCell colSpan={7} className="py-16 text-center space-y-3">
                    <FileText className="h-10 w-10 text-muted-foreground/30 mx-auto" />
                    <div className="text-sm text-muted-foreground">
                      {search || statusFilter ? 'No invoices match your filter.' : 'No invoices yet.'}
                    </div>
                    {!search && !statusFilter && (
                      <Button size="sm" onClick={() => setGenerateOpen(true)}>
                        <Plus className="h-3.5 w-3.5 mr-1.5" /> Generate First Invoice
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <GenerateInvoiceDialog
        open={generateOpen}
        onOpenChange={setGenerateOpen}
        token={token}
        onSuccess={handleGenerateSuccess}
      />
    </div>
  );
}
