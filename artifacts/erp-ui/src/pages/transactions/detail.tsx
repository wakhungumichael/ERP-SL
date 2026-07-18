import { useState } from 'react';
import { useAuth } from '@/context/use-auth';
import { useQueryClient } from '@tanstack/react-query';
import { useGetTransaction, getGetTransactionQueryKey } from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import {
  ArrowLeft, CheckCircle2, RotateCcw, Download, Printer, AlertTriangle,
  Scale, DollarSign, FileText,
} from 'lucide-react';
import { Link } from 'wouter';
import { ReceiptDialog } from '@/components/weighbridge/receipt';
import { CAN_APPROVE, CAN_RECALL, CAN_EXPORT } from '@/lib/roles';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_STYLE: Record<string, string> = {
  Pending:   'bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-900/30 dark:text-orange-400',
  Completed: 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-900/30 dark:text-emerald-400',
};
const PAY_STYLE: Record<string, string> = {
  Paid:    'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-900/30 dark:text-emerald-400',
  Pending: 'bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-900/30 dark:text-orange-400',
};

function Field({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="grid grid-cols-5 gap-2 py-2 border-b last:border-0">
      <span className="col-span-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground flex items-center">
        {label}
      </span>
      <span className={`col-span-3 text-sm ${mono ? 'font-mono' : 'font-medium'} break-all`}>
        {value ?? <span className="text-muted-foreground/40">—</span>}
      </span>
    </div>
  );
}

// ── Receive Payment Dialog ────────────────────────────────────────────────────

interface ReceivePaymentDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  transactionId: number;
  token: string | null;
  onSuccess: (invoiceId: number | null) => void;
}

function ReceivePaymentDialog({ open, onOpenChange, transactionId, token, onSuccess }: ReceivePaymentDialogProps) {
  const { toast } = useToast();
  const [method, setMethod] = useState('Cash');
  const [reference, setReference] = useState('');
  const [loading, setLoading] = useState(false);

  const handleConfirm = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/commercial-weighbridge/transactions/${transactionId}/receive-payment/`, {
        method: 'POST',
        headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ method, reference }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? res.statusText);
      toast({ title: 'Payment recorded', description: 'Transaction marked as Paid.' });
      onSuccess(body.invoice_id ?? null);
      onOpenChange(false);
    } catch (err: any) {
      toast({ title: 'Payment failed', description: err?.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const methods = ['Cash', 'Mpesa', 'Bank Deposit', 'Debt'];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <DollarSign className="h-4 w-4" /> Receive Payment
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label>Payment Method</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {methods.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Reference / Receipt #</Label>
            <Input
              placeholder="e.g. MPE-12345 or CHQ-0001"
              value={reference}
              onChange={e => setReference(e.target.value)}
              className="font-mono text-sm"
            />
          </div>
        </div>
        <DialogFooter className="pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={loading}
            onClick={handleConfirm}
            className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5"
          >
            <CheckCircle2 className="h-4 w-4" />
            {loading ? 'Processing…' : 'Confirm Payment'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function TransactionDetail({ id }: { id: string }) {
  const numericId = parseInt(id, 10);
  const { token, role } = useAuth();
  const { toast }       = useToast();
  const queryClient     = useQueryClient();

  const { data, isLoading } = useGetTransaction(numericId, {
    query: { enabled: !isNaN(numericId), queryKey: getGetTransactionQueryKey(numericId) },
  });

  const [acting, setActing]         = useState<'approve' | 'recall' | null>(null);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [payOpen, setPayOpen]       = useState(false);
  const [invoiceId, setInvoiceId]   = useState<number | null>(null);

  if (isLoading) return (
    <div className="p-12 text-center text-muted-foreground font-mono animate-pulse">
      Loading transaction…
    </div>
  );
  if (!data) return (
    <div className="p-12 text-center text-destructive font-mono">
      Transaction not found.
    </div>
  );

  const tx = data as any;

  // ── Actions ─────────────────────────────────────────────────────────────────

  const canApprove       = CAN_APPROVE.includes(role) && !tx.approval_status;
  const canRecall        = CAN_RECALL.includes(role) && tx.status === 'Completed';
  const canExport        = CAN_EXPORT.includes(role);
  const canReceivePayment = tx.status === 'Completed' && tx.payment_status !== 'Paid';
  const isPaid           = tx.payment_status === 'Paid';
  // auto_invoice_id from API, or an invoice returned after receive-payment
  const linkedInvoiceId  = invoiceId ?? tx.auto_invoice_id ?? null;

  const postAction = async (action: 'approve' | 'recall') => {
    setActing(action);
    try {
      const res = await fetch(`/api/commercial-weighbridge/transactions/${numericId}/${action}/`, {
        method: 'POST',
        headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json' },
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? res.statusText);
      toast({
        title: action === 'approve' ? 'Transaction approved' : 'Transaction recalled',
        description: action === 'approve'
          ? 'The record has been marked as approved.'
          : 'Transaction set back to Pending. First weight un-paired.',
      });
      queryClient.invalidateQueries({ queryKey: getGetTransactionQueryKey(numericId) });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
    } catch (err: any) {
      toast({ title: 'Action failed', description: err?.message, variant: 'destructive' });
    } finally {
      setActing(null);
    }
  };

  const handleExportCSV = () => {
    window.open(
      `/api/commercial-weighbridge/transactions/export/csv/?vehicle_plate=${tx.vehicle_plate ?? ''}&search=${tx.vehicle_plate ?? ''}`,
      '_blank',
    );
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 max-w-4xl mx-auto">

      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <div className="flex items-center gap-3">
          <Link href="/weighbridge/transactions">
            <Button variant="outline" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight font-mono">
                TX-{String(tx.id).padStart(5, '0')}
              </h1>
              <span className={`px-2.5 py-0.5 rounded text-[10px] font-bold tracking-widest uppercase border ${STATUS_STYLE[tx.status] ?? 'bg-secondary border-border'}`}>
                {tx.status}
              </span>
              {tx.approval_status && (
                <span className="px-2.5 py-0.5 rounded text-[10px] font-bold tracking-widest uppercase border bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-900/30 dark:text-emerald-400 flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" /> Approved
                </span>
              )}
              {tx.manual_weight_capture && (
                <span className="px-2.5 py-0.5 rounded text-[10px] font-bold tracking-widest uppercase border bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/30 dark:text-amber-400 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" /> Manual
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {tx.weight_type} · {tx.branch_name ?? 'Unknown branch'} · {tx.vehicle_plate}
            </p>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap gap-2">
          {canApprove && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 text-xs font-bold uppercase tracking-wide border-emerald-400 text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-900/20"
              disabled={acting !== null}
              onClick={() => postAction('approve')}
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              {acting === 'approve' ? 'Approving…' : 'Approve'}
            </Button>
          )}
          {canRecall && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 text-xs font-bold uppercase tracking-wide border-amber-400 text-amber-700 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-900/20"
              disabled={acting !== null}
              onClick={() => postAction('recall')}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {acting === 'recall' ? 'Recalling…' : 'Recall'}
            </Button>
          )}
          {canReceivePayment && (
            <Button
              size="sm"
              className="gap-1.5 text-xs font-bold uppercase tracking-wide bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={() => setPayOpen(true)}
            >
              <DollarSign className="h-3.5 w-3.5" /> Receive Payment
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 text-xs font-bold uppercase tracking-wide"
            disabled={!isPaid}
            onClick={() => setReceiptOpen(true)}
          >
            <Printer className="h-3.5 w-3.5" /> Receipt
          </Button>
          {canExport && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 text-xs font-bold uppercase tracking-wide"
              onClick={handleExportCSV}
            >
              <Download className="h-3.5 w-3.5" /> Export CSV
            </Button>
          )}
        </div>
      </div>

      {/* Manual capture warning */}
      {tx.manual_weight_capture && (
        <div className="flex items-start gap-3 p-4 rounded-lg bg-amber-50 border border-amber-200 dark:bg-amber-900/20 dark:border-amber-800">
          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
          <div>
            <div className="text-sm font-bold text-amber-800 dark:text-amber-400">Manual weight capture</div>
            <div className="text-xs text-amber-700 dark:text-amber-500 mt-0.5">
              {tx.weight_reason ? `Reason: ${tx.weight_reason}` : 'No reason recorded.'}
              {!tx.approval_status && canApprove && ' — Review and approve below.'}
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Weight card */}
        <Card>
          <CardHeader className="bg-muted/20 border-b">
            <CardTitle className="text-xs font-bold uppercase tracking-widest flex items-center gap-2">
              <Scale className="h-4 w-4" /> Weight Data
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {/* Big weight display */}
            <div className="p-6 space-y-4">
              <div className="flex justify-between items-center border-b pb-3">
                <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Gross Weight</span>
                <span className="font-mono text-xl font-bold">
                  {tx.gross_weight ? Number(tx.gross_weight).toLocaleString() : '—'} <span className="text-xs text-muted-foreground">kg</span>
                </span>
              </div>
              <div className="flex justify-between items-center border-b pb-3">
                <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Tare Weight</span>
                <span className="font-mono text-xl font-bold">
                  {tx.tare_weight ? Number(tx.tare_weight).toLocaleString() : '—'} <span className="text-xs text-muted-foreground">kg</span>
                </span>
              </div>
              <div className="flex justify-between items-center bg-emerald-50 dark:bg-emerald-900/10 p-4 rounded-lg border border-emerald-200 dark:border-emerald-800">
                <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-800 dark:text-emerald-400">Net Weight</span>
                <span className="font-mono text-3xl font-black text-emerald-600 dark:text-emerald-400">
                  {tx.net_weight ? Number(tx.net_weight).toLocaleString() : '—'} <span className="text-sm">kg</span>
                </span>
              </div>
            </div>

            {/* Weight dates */}
            <div className="border-t px-6 py-4 space-y-0">
              <Field label="Gross Wt. Date" value={tx.gross_weight_date ? new Date(tx.gross_weight_date).toLocaleString('en-KE') : null} mono />
              <Field label="Tare Wt. Date"  value={tx.tare_weight_date  ? new Date(tx.tare_weight_date).toLocaleString('en-KE')  : null} mono />
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          {/* Entity details */}
          <Card>
            <CardHeader className="bg-muted/20 border-b">
              <CardTitle className="text-xs font-bold uppercase tracking-widest">Entity Details</CardTitle>
            </CardHeader>
            <CardContent className="p-6 py-2">
              <Field label="Customer"     value={tx.customer_name} />
              <Field label="Vehicle"      value={<span className="font-mono font-bold">{tx.vehicle_plate}</span>} />
              <Field label="Vehicle Type" value={tx.vehicle_type_name || null} />
              <Field label="Item"         value={tx.item_name || null} />
              <Field label="Branch"       value={tx.branch_name || null} />
              <Field label="Destination"  value={tx.destination || null} />
            </CardContent>
          </Card>

          {/* Payment & charge */}
          <Card>
            <CardHeader className="bg-muted/20 border-b">
              <CardTitle className="text-xs font-bold uppercase tracking-widest">Payment & Charge</CardTitle>
            </CardHeader>
            <CardContent className="p-6 py-2">
              <Field label="Charge"
                value={tx.charge ? <span className="font-mono font-bold text-foreground">KES {Number(tx.charge).toLocaleString()}</span> : null}
              />
              <Field label="Pay. Mode" value={tx.payment_mode || null} />
              <Field label="Pay. Status"
                value={
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold tracking-widest uppercase border ${PAY_STYLE[tx.payment_status] ?? 'bg-secondary border-border'}`}>
                    {tx.payment_status || 'Pending'}
                  </span>
                }
              />
              <Field label="Invoiced" value={tx.invoiced ? 'Yes' : 'No'} />
              {linkedInvoiceId && (
                <Field
                  label="Invoice"
                  value={
                    <Link href={`/payments/invoices/${linkedInvoiceId}`}>
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold tracking-widest uppercase border bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-900/30 dark:text-blue-400 cursor-pointer hover:bg-blue-200 transition-colors">
                        <FileText className="h-3 w-3" /> View Invoice
                      </span>
                    </Link>
                  }
                />
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Admin card */}
      <Card>
        <CardHeader className="bg-muted/20 border-b">
          <CardTitle className="text-xs font-bold uppercase tracking-widest">Administrative</CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-12">
            <div>
              <Field label="Operator"     value={tx.operator || 'SYS_AUTO'} mono />
              <Field label="Weight Type"  value={tx.weight_type} />
              <Field label="Status"
                value={
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold tracking-widest uppercase border ${STATUS_STYLE[tx.status] ?? ''}`}>
                    {tx.status}
                  </span>
                }
              />
              <Field label="Approved"
                value={
                  tx.approval_status
                    ? <span className="text-emerald-600 dark:text-emerald-400 font-bold text-xs flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" /> Yes</span>
                    : <span className="text-muted-foreground text-xs">No</span>
                }
              />
            </div>
            <div>
              <Field label="Paired"       value={tx.paired ? 'Yes' : 'No'} />
              <Field label="Paired TX"    value={tx.paired_first_transaction ? `TX-${String(tx.paired_first_transaction).padStart(5, '0')}` : null} mono />
              <Field label="Created"      value={tx.created_at ? new Date(tx.created_at).toLocaleString('en-KE') : null} mono />
              <Field label="Updated"      value={tx.updated_at ? new Date(tx.updated_at).toLocaleString('en-KE') : null} mono />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Receipt dialog */}
      <ReceiptDialog transaction={tx} open={receiptOpen} onOpenChange={setReceiptOpen} />

      {/* Receive Payment dialog */}
      <ReceivePaymentDialog
        open={payOpen}
        onOpenChange={setPayOpen}
        transactionId={numericId}
        token={token}
        onSuccess={(invId) => {
          if (invId) setInvoiceId(invId);
          queryClient.invalidateQueries({ queryKey: getGetTransactionQueryKey(numericId) });
          queryClient.invalidateQueries({ queryKey: ['transactions'] });
        }}
      />
    </div>
  );
}
