import { useEffect, useState } from 'react';
import { useAuth } from '@/context/use-auth';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useGetTransaction, getGetTransactionQueryKey } from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { ERP_BRANCHES_QUERY_KEY, fetchErpBranches } from '@/lib/branches';
import {
  ArrowLeft, CheckCircle2, BadgeCheck, RotateCcw, Download, Printer, AlertTriangle,
  Scale, Wallet, FileText,
} from 'lucide-react';
import { Link } from 'wouter';
import { ReceiptDialog } from '@/components/weighbridge/receipt';
import { RecordAuditTrail } from '@/components/audit/record-audit-trail';
import { CAN_APPROVE, CAN_RECALL, CAN_EXPORT } from '@/lib/roles';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_STYLE: Record<string, string> = {
  Draft:     'bg-slate-100 text-slate-800 border-slate-300 dark:bg-slate-900/30 dark:text-slate-300',
  Recalled:  'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/30 dark:text-amber-400',
  Rejected:  'bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-900/30 dark:text-rose-400',
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

interface EditTransactionDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  transaction: any;
  token: string | null;
  onSaved: () => void;
}

function EditTransactionDialog({ open, onOpenChange, transaction, token, onSaved }: EditTransactionDialogProps) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    branch: '',
    customer: '',
    vehicle: '',
    vehicle_type: '',
    operation_type: '',
    item: '',
    destination: '',
  });

  useEffect(() => {
    if (!transaction) return;
    setForm({
      branch: transaction.branch ? String(transaction.branch) : '',
      customer: transaction.customer ? String(transaction.customer) : '',
      vehicle: transaction.vehicle ? String(transaction.vehicle) : '',
      vehicle_type: transaction.vehicle_type ? String(transaction.vehicle_type) : '',
      operation_type: transaction.operation_type ? String(transaction.operation_type) : '',
      item: transaction.item ? String(transaction.item) : '',
      destination: transaction.destination ?? '',
    });
  }, [transaction]);

  const fetchList = async (url: string) => {
    const res = await fetch(url, { headers: { Authorization: `Token ${token}` } });
    if (!res.ok) throw new Error(`${res.status}`);
    return res.json();
  };

  const { data: branches = [] } = useQuery({
    queryKey: ERP_BRANCHES_QUERY_KEY,
    queryFn: () => fetchErpBranches(token!),
    enabled: open && !!token,
  });
  const { data: customers = [] } = useQuery({
    queryKey: ['edit-tx-customers'],
    queryFn: () => fetchList('/api/commercial-weighbridge/customers/?search='),
    enabled: open && !!token,
  });
  const { data: vehicles = [] } = useQuery({
    queryKey: ['edit-tx-vehicles', form.customer],
    queryFn: () => fetchList(`/api/commercial-weighbridge/vehicles/?customer_id=${form.customer}`),
    enabled: open && !!token && !!form.customer,
  });
  const { data: items = [] } = useQuery({
    queryKey: ['edit-tx-items'],
    queryFn: () => fetchList('/api/commercial-weighbridge/items/'),
    enabled: open && !!token,
  });
  const { data: vehicleTypes = [] } = useQuery({
    queryKey: ['edit-tx-vehicle-types'],
    queryFn: () => fetchList('/api/commercial-weighbridge/vehicle-types/'),
    enabled: open && !!token,
  });
  const { data: operationTypes = [] } = useQuery({
    queryKey: ['edit-tx-operation-types'],
    queryFn: () => fetchList('/api/commercial-weighbridge/weighing-operation-types/'),
    enabled: open && !!token,
  });

  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        branch: Number(form.branch),
        customer: Number(form.customer),
        vehicle: Number(form.vehicle),
        vehicle_type: Number(form.vehicle_type),
        destination: form.destination,
      };
      if (form.item) payload.item = Number(form.item);
      if (form.operation_type) payload.operation_type = Number(form.operation_type);
      const res = await fetch(`/api/commercial-weighbridge/transactions/${transaction.id}/`, {
        method: 'PATCH',
        headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.detail ?? body?.error ?? res.statusText);
      toast({ title: 'Transaction updated' });
      onOpenChange(false);
      onSaved();
    } catch (err: any) {
      toast({ title: 'Update failed', description: err?.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit Transaction</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Branch</Label>
            <Select value={form.branch} onValueChange={v => setForm(p => ({ ...p, branch: v }))}>
              <SelectTrigger><SelectValue placeholder="Select branch…" /></SelectTrigger>
              <SelectContent>{(branches as any[]).map((b: any) => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Operation Type</Label>
            <Select value={form.operation_type} onValueChange={v => setForm(p => ({ ...p, operation_type: v }))}>
              <SelectTrigger><SelectValue placeholder="Select operation type…" /></SelectTrigger>
              <SelectContent>{(operationTypes as any[]).filter((row: any) => row.is_active).map((row: any) => <SelectItem key={row.id} value={String(row.id)}>{row.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Customer</Label>
            <Select value={form.customer} onValueChange={v => setForm(p => ({ ...p, customer: v, vehicle: '' }))}>
              <SelectTrigger><SelectValue placeholder="Select customer…" /></SelectTrigger>
              <SelectContent>{(customers as any[]).map((c: any) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Vehicle</Label>
            <Select value={form.vehicle} onValueChange={v => setForm(p => ({ ...p, vehicle: v }))} disabled={!form.customer}>
              <SelectTrigger><SelectValue placeholder="Select vehicle…" /></SelectTrigger>
              <SelectContent>{(vehicles as any[]).map((v: any) => <SelectItem key={v.id} value={String(v.id)}>{v.number_plate}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Vehicle Type</Label>
            <Select value={form.vehicle_type} onValueChange={v => setForm(p => ({ ...p, vehicle_type: v }))}>
              <SelectTrigger><SelectValue placeholder="Select vehicle type…" /></SelectTrigger>
              <SelectContent>{(vehicleTypes as any[]).map((v: any) => <SelectItem key={v.id} value={String(v.id)}>{v.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Item</Label>
            <Select value={form.item || '__none__'} onValueChange={v => setForm(p => ({ ...p, item: v === '__none__' ? '' : v }))}>
              <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Optional</SelectItem>
                {(items as any[]).map((i: any) => <SelectItem key={i.id} value={String(i.id)}>{i.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label>Destination</Label>
            <Input value={form.destination} onChange={e => setForm(p => ({ ...p, destination: e.target.value }))} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
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
      toast({ title: 'Payment updated', description: body?.message ?? 'Transaction payment updated.' });
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
            <Wallet className="h-4 w-4" /> Receive Payment
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

  const [acting, setActing]         = useState<'approve' | 'recall' | 'reject' | null>(null);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [payOpen, setPayOpen]       = useState(false);
  const [editOpen, setEditOpen]     = useState(false);
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

  const canApprove       = CAN_APPROVE.includes(role) && ['Draft', 'Recalled'].includes(tx.status) && !tx.approval_status && !!tx.manual_weight_capture;
  const canRecall        = CAN_RECALL.includes(role) && tx.status === 'Completed';
  const canReject        = CAN_APPROVE.includes(role) && tx.status !== 'Completed';
  const canExport        = CAN_EXPORT.includes(role);
  const canEdit          = tx.status !== 'Completed';
  const canReceivePayment = tx.payment_status !== 'Paid' && tx.status !== 'Rejected';
  const canPrintReceipt  = tx.status === 'Completed';
  // auto_invoice_id from API, or an invoice returned after receive-payment
  const linkedInvoiceId  = invoiceId ?? tx.auto_invoice_id ?? null;

  const postAction = async (action: 'approve' | 'recall' | 'reject') => {
    setActing(action);
    try {
      const res = await fetch(`/api/commercial-weighbridge/transactions/${numericId}/${action}/`, {
        method: 'POST',
        headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json' },
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? res.statusText);
      toast({
        title: action === 'approve' ? 'Transaction approved' : action === 'recall' ? 'Transaction recalled' : 'Transaction rejected',
        description: action === 'approve'
          ? 'The record has been approved and moved to Completed.'
          : action === 'recall'
            ? 'Transaction moved to Recalled for editing. First weight un-paired.'
            : 'Transaction moved to Rejected.',
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
                  <BadgeCheck className="h-3 w-3" /> Approved
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
              <BadgeCheck className="h-3.5 w-3.5" />
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
          {canReject && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 text-xs font-bold uppercase tracking-wide border-rose-400 text-rose-700 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-900/20"
              disabled={acting !== null}
              onClick={() => postAction('reject')}
            >
              {acting === 'reject' ? 'Rejecting…' : 'Reject'}
            </Button>
          )}
          {canEdit && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 text-xs font-bold uppercase tracking-wide"
              onClick={() => setEditOpen(true)}
            >
              Edit
            </Button>
          )}
          {canReceivePayment && (
            <Button
              size="sm"
              className="gap-1.5 text-xs font-bold uppercase tracking-wide bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={() => setPayOpen(true)}
            >
              <Wallet className="h-3.5 w-3.5" /> Receive Payment
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 text-xs font-bold uppercase tracking-wide"
            disabled={!canPrintReceipt}
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
              {!tx.approval_status && canApprove && ' — Receive payment if needed, then approve to move it to Completed.'}
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
              <Field label="Reference" value={tx.payment_reference || null} mono />
              <Field label="Paid At" value={tx.payment_received_at ? new Date(tx.payment_received_at).toLocaleString('en-KE') : null} mono />
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
                    ? <span className="text-emerald-600 dark:text-emerald-400 font-bold text-xs flex items-center gap-1"><BadgeCheck className="h-3.5 w-3.5" /> Yes</span>
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

      <RecordAuditTrail modelLabel="SL_Weighbridge.Transaction" objectPk={numericId} />

      <EditTransactionDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        transaction={tx}
        token={token}
        onSaved={() => {
          queryClient.invalidateQueries({ queryKey: getGetTransactionQueryKey(numericId) });
          queryClient.invalidateQueries({ queryKey: ['transactions'] });
        }}
      />

      {/* Receipt dialog */}
      <ReceiptDialog transaction={tx} open={receiptOpen} onOpenChange={setReceiptOpen} token={token} />

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
