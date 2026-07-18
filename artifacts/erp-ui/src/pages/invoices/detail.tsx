import { useState } from 'react';
import { useLocation } from 'wouter';
import {
  useGetInvoice, getGetInvoiceQueryKey,
  useReceivePayment, useIssueInvoice,
  useListPaymentMethods, getListPaymentMethodsQueryKey,
} from '@workspace/api-client-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/use-auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
  ArrowLeft, CheckCircle2, DollarSign, Send, FileText,
  Building2, Hash, Calendar, AlertCircle, Printer,
} from 'lucide-react';

/* ─────────────────────────────────────────── helpers ── */
function kes(v: number | null | undefined, currency = 'KES') {
  return `${currency} ${Number(v ?? 0).toLocaleString('en-KE', { minimumFractionDigits: 2 })}`;
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
    <span className={`px-3 py-1 rounded text-xs font-bold tracking-widest uppercase border ${m.cls}`}>
      {m.label}
    </span>
  );
}

/* ─────────────────────────────────────────── Receive Payment dialog ── */
function ReceivePaymentDialog({
  invoiceId, amount, currency, open, onOpenChange, onSuccess,
}: {
  invoiceId: number; amount: number; currency: string;
  open: boolean; onOpenChange: (v: boolean) => void; onSuccess: () => void;
}) {
  const { toast } = useToast();
  const receivePayment = useReceivePayment();
  const { data: methods } = useListPaymentMethods({ query: { queryKey: getListPaymentMethodsQueryKey() } });
  const [form, setForm] = useState({ amount, method: 1, payment_mode: 'Cash', reference: '' });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    receivePayment.mutate(
      { id: invoiceId, data: { amount: form.amount, method: form.method, reference: form.reference } },
      {
        onSuccess: () => {
          toast({ title: 'Payment received — invoice marked Paid' });
          onSuccess();
          onOpenChange(false);
        },
        onError: (err: any) =>
          toast({ title: 'Payment failed', description: err?.message, variant: 'destructive' }),
      },
    );
  };

  const methodList = (methods as any[]) ?? [
    { id: 1, name: 'Cash' }, { id: 2, name: 'Mpesa' }, { id: 3, name: 'Bank Deposit' }, { id: 4, name: 'Debt' },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <DollarSign className="h-4 w-4" /> Receive Payment
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label>Amount ({currency})</Label>
            <Input
              type="number" step="0.01" min="0"
              value={form.amount}
              onChange={e => setForm(f => ({ ...f, amount: Number(e.target.value) }))}
              required className="font-mono text-lg font-bold"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Payment Method</Label>
            <Select
              value={String(form.method)}
              onValueChange={v => {
                const m = methodList.find((x: any) => String(x.id) === v);
                setForm(f => ({ ...f, method: Number(v), payment_mode: m?.name ?? 'Cash' }));
              }}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {methodList.map((m: any) => (
                  <SelectItem key={m.id} value={String(m.id)}>{m.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Reference / Receipt #</Label>
            <Input
              placeholder="e.g. MPE-12345 or CHQ-0001"
              value={form.reference}
              onChange={e => setForm(f => ({ ...f, reference: e.target.value }))}
              className="font-mono text-sm"
            />
          </div>
          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button
              type="submit"
              disabled={receivePayment.isPending}
              className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5"
            >
              <CheckCircle2 className="h-4 w-4" />
              {receivePayment.isPending ? 'Processing…' : 'Confirm Payment'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ════════════════════════════════════════════════════════ main page ── */
export default function InvoiceDetail({ id }: { id: string }) {
  const { token } = useAuth();
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const numericId = parseInt(id, 10);
  const [payOpen, setPayOpen] = useState(false);

  /* Full detail via raw fetch so we get transactions + lines */
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['invoice-detail-full', numericId],
    queryFn: async () => {
      const res = await fetch(`/api/payments/invoices/${numericId}/`, {
        headers: { Authorization: `Token ${token}` },
      });
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    enabled: !!token && !isNaN(numericId),
    staleTime: 10_000,
  });

  const issueInvoice = useIssueInvoice();

  const handleIssue = () => {
    issueInvoice.mutate({ id: numericId }, {
      onSuccess: () => {
        toast({ title: 'Invoice issued' });
        refetch();
        qc.invalidateQueries({ queryKey: ['invoices'] });
      },
      onError: (err: any) =>
        toast({ title: 'Failed to issue', description: err?.message, variant: 'destructive' }),
    });
  };

  if (isLoading) return (
    <div className="flex items-center justify-center h-64">
      <div className="text-sm text-muted-foreground animate-pulse">Loading invoice…</div>
    </div>
  );
  if (!data) return (
    <div className="p-12 text-center text-destructive">Invoice not found.</div>
  );

  const inv = data;
  const lines: any[]  = inv.lines        ?? [];
  const txns: any[]   = inv.transactions ?? [];
  const isOverdue = inv.due_date && inv.status === 'issued' && new Date(inv.due_date) < new Date();
  const displayStatus = isOverdue ? 'overdue' : inv.status;

  const canIssue   = inv.status === 'draft' || inv.status === 'Pending';
  const canPay     = inv.status === 'issued' || inv.status === 'Pending' || isOverdue;
  const isPaid     = inv.status === 'paid' || inv.status === 'Paid';

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between border-b pb-4 gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" onClick={() => navigate('/payments/invoices')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight font-mono">{inv.invoice_number}</h1>
              <StatusBadge s={displayStatus} />
              {isOverdue && (
                <span className="flex items-center gap-1 text-xs text-red-600 font-bold">
                  <AlertCircle className="h-3.5 w-3.5" /> OVERDUE
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {inv.customer_name} · Created {inv.created_at ? new Date(inv.created_at).toLocaleDateString('en-KE') : '—'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {canIssue && (
            <Button
              variant="outline"
              className="gap-1.5 text-sm"
              onClick={handleIssue}
              disabled={issueInvoice.isPending}
            >
              <Send className="h-4 w-4" />
              {issueInvoice.isPending ? 'Issuing…' : 'Issue Invoice'}
            </Button>
          )}
          {canPay && (
            <Button
              className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={() => setPayOpen(true)}
            >
              <CheckCircle2 className="h-4 w-4" /> Receive Payment
            </Button>
          )}
          {isPaid && (
            <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 gap-1 px-3 py-1.5 text-sm">
              <CheckCircle2 className="h-3.5 w-3.5" /> Fully Paid
            </Badge>
          )}
          <Button variant="ghost" size="icon" title="Print (coming soon)" disabled>
            <Printer className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Top cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Customer */}
        <Card>
          <CardHeader className="pb-2 bg-muted/20 border-b">
            <CardTitle className="text-xs font-bold uppercase tracking-widest flex items-center gap-1.5">
              <Building2 className="h-3.5 w-3.5" /> Billed To
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 space-y-1.5">
            <div className="font-bold text-base">{inv.customer_name || '—'}</div>
            {inv.customer_email && <div className="text-sm text-muted-foreground">{inv.customer_email}</div>}
            {inv.customer_phone && <div className="text-sm text-muted-foreground">{inv.customer_phone}</div>}
          </CardContent>
        </Card>

        {/* Reference */}
        <Card>
          <CardHeader className="pb-2 bg-muted/20 border-b">
            <CardTitle className="text-xs font-bold uppercase tracking-widest flex items-center gap-1.5">
              <Hash className="h-3.5 w-3.5" /> Reference
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 space-y-2">
            <div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Invoice #</div>
              <div className="font-mono font-bold">{inv.invoice_number}</div>
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Currency</div>
              <div className="font-mono">{inv.currency || 'KES'}</div>
            </div>
          </CardContent>
        </Card>

        {/* Dates */}
        <Card>
          <CardHeader className="pb-2 bg-muted/20 border-b">
            <CardTitle className="text-xs font-bold uppercase tracking-widest flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" /> Dates
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 space-y-2">
            <div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Created</div>
              <div className="text-sm font-mono">{inv.created_at ? new Date(inv.created_at).toLocaleDateString('en-KE') : '—'}</div>
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Issued</div>
              <div className="text-sm font-mono">{inv.issued_at ? new Date(inv.issued_at).toLocaleDateString('en-KE') : 'Not yet issued'}</div>
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Due</div>
              <div className={`text-sm font-mono font-bold ${isOverdue ? 'text-red-600' : ''}`}>
                {inv.due_date ? new Date(inv.due_date).toLocaleDateString('en-KE') : 'Upon receipt'}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Line items */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
            Line Items {lines.length > 0 && `(${lines.length})`}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead className="text-[10px] font-bold uppercase tracking-widest">Vehicle Type</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-widest text-right">Qty</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-widest text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.length === 0 ? (
                <TableRow><TableCell colSpan={3} className="py-6 text-center text-sm text-muted-foreground">No line items.</TableCell></TableRow>
              ) : lines.map((line: any) => (
                <TableRow key={line.id} className="hover:bg-muted/30">
                  <TableCell className="py-2 text-sm font-medium">{line.vehicle_type || 'General'}</TableCell>
                  <TableCell className="py-2 text-right font-mono text-sm">{line.quantity}</TableCell>
                  <TableCell className="py-2 text-right font-mono font-bold text-sm">
                    {kes(line.total, inv.currency)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {/* Total row */}
          <div className="flex items-center justify-between p-4 border-t bg-muted/20">
            <span className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Total</span>
            <span className="font-mono font-black text-2xl">{kes(inv.total_amount, inv.currency)}</span>
          </div>
        </CardContent>
      </Card>

      {/* Linked transactions */}
      {txns.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              Linked Transactions ({txns.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead className="text-[10px] font-bold uppercase tracking-widest">TX ID</TableHead>
                  <TableHead className="text-[10px] font-bold uppercase tracking-widest">Vehicle</TableHead>
                  <TableHead className="text-[10px] font-bold uppercase tracking-widest">Type</TableHead>
                  <TableHead className="text-[10px] font-bold uppercase tracking-widest text-right">Net Weight</TableHead>
                  <TableHead className="text-[10px] font-bold uppercase tracking-widest">Payment</TableHead>
                  <TableHead className="text-[10px] font-bold uppercase tracking-widest text-right">Charge</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {txns.map((t: any) => (
                  <TableRow key={t.id} className="hover:bg-muted/30">
                    <TableCell className="py-2 font-mono text-xs text-primary font-bold">
                      TX-{String(t.id).padStart(5, '0')}
                    </TableCell>
                    <TableCell className="py-2 text-sm font-mono">{t.vehicle_plate}</TableCell>
                    <TableCell className="py-2 text-xs text-muted-foreground">{t.vehicle_type}</TableCell>
                    <TableCell className="py-2 text-right font-mono text-xs">
                      {t.net_weight?.toLocaleString('en-KE')} kg
                    </TableCell>
                    <TableCell className="py-2 text-xs">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${t.payment_status === 'Paid' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                        {t.payment_mode} · {t.payment_status}
                      </span>
                    </TableCell>
                    <TableCell className="py-2 text-right font-mono text-sm font-bold">
                      {kes(t.charge, inv.currency)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Notes */}
      {inv.notes && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Notes</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">{inv.notes}</CardContent>
        </Card>
      )}

      {/* Payment dialog */}
      <ReceivePaymentDialog
        invoiceId={numericId}
        amount={inv.total_amount ?? 0}
        currency={inv.currency ?? 'KES'}
        open={payOpen}
        onOpenChange={setPayOpen}
        onSuccess={() => {
          refetch();
          qc.invalidateQueries({ queryKey: ['invoices'] });
          qc.invalidateQueries({ queryKey: getGetInvoiceQueryKey(numericId) });
        }}
      />
    </div>
  );
}
