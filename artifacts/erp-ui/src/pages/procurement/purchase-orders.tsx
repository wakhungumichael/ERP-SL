import { useState, useCallback } from 'react';
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
import type { ReactElement } from 'react';
import {
  ShoppingCart, Truck, Package, Search, Plus, Trash2,
  ChevronRight, CheckCircle2, Clock, XCircle, ArrowRight, X,
} from 'lucide-react';

/* ────────────────────────────────────────────────────────────── helpers ── */
const STATUS_META: Record<string, { label: string; cls: string; icon: ReactElement }> = {
  Draft:     { label: 'Draft',     cls: 'bg-secondary text-secondary-foreground', icon: <Clock className="h-3 w-3" /> },
  Submitted: { label: 'Submitted', cls: 'bg-blue-100 text-blue-800',              icon: <ArrowRight className="h-3 w-3" /> },
  Approved:  { label: 'Approved',  cls: 'bg-emerald-100 text-emerald-800',         icon: <CheckCircle2 className="h-3 w-3" /> },
  Received:  { label: 'Received',  cls: 'bg-purple-100 text-purple-800',           icon: <Package className="h-3 w-3" /> },
  Cancelled: { label: 'Cancelled', cls: 'bg-red-100 text-red-800',                icon: <XCircle className="h-3 w-3" /> },
};

const ALL_STATUSES = Object.keys(STATUS_META);

function kes(v: number | string | null | undefined) {
  const n = Number(v ?? 0);
  return `KES ${n.toLocaleString('en-KE', { minimumFractionDigits: 2 })}`;
}

function StatusBadge({ status }: { status: string }) {
  const m = STATUS_META[status] ?? { label: status, cls: 'bg-secondary', icon: null };
  return (
    <Badge className={`${m.cls} gap-1 text-[10px] font-bold`}>
      {m.icon}{m.label}
    </Badge>
  );
}

/* ─────────────────────────────────────────────────── New PO dialog ── */
interface NewPODialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  token: string | null;
  onSuccess: () => void;
}

interface LineItem {
  description: string;
  unit: string;
  quantity: string;
  unit_price: string;
}

function newLine(): LineItem {
  return { description: '', unit: 'pcs', quantity: '1', unit_price: '0' };
}

function NewPODialog({ open, onOpenChange, token, onSuccess }: NewPODialogProps) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    supplier_name: '', supplier_email: '', supplier_phone: '',
    order_date: new Date().toISOString().slice(0, 10),
    expected_date: '',
    currency: 'KES',
    notes: '',
  });
  const [items, setItems] = useState<LineItem[]>([newLine()]);

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const updateItem = (i: number, k: keyof LineItem, v: string) =>
    setItems(prev => prev.map((r, idx) => idx === i ? { ...r, [k]: v } : r));

  const addItem = () => setItems(prev => [...prev, newLine()]);
  const removeItem = (i: number) => setItems(prev => prev.filter((_, idx) => idx !== i));

  const computedTotal = items.reduce((s, r) => s + Number(r.quantity || 0) * Number(r.unit_price || 0), 0);

  const handleSave = async () => {
    if (!form.supplier_name || !form.order_date) {
      toast({ title: 'Supplier name and order date are required', variant: 'destructive' }); return;
    }
    const validItems = items.filter(r => r.description.trim());
    setSaving(true);
    try {
      const res = await fetch('/api/procurement/orders/', {
        method: 'POST',
        headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          total_amount: computedTotal,
          items: validItems.map(r => ({
            description: r.description,
            unit: r.unit,
            quantity: Number(r.quantity || 1),
            unit_price: Number(r.unit_price || 0),
          })),
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? res.statusText);
      toast({ title: 'Purchase order created' });
      onSuccess();
      onOpenChange(false);
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Purchase Order</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {/* Supplier */}
          <div className="border rounded-lg p-3 space-y-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Supplier</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-3 space-y-1">
                <Label>Supplier Name *</Label>
                <Input placeholder="Company or individual name" value={form.supplier_name} onChange={e => set('supplier_name', e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Email</Label>
                <Input type="email" placeholder="supplier@example.com" value={form.supplier_email} onChange={e => set('supplier_email', e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Phone</Label>
                <Input placeholder="+254 …" value={form.supplier_phone} onChange={e => set('supplier_phone', e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Currency</Label>
                <Select value={form.currency} onValueChange={v => set('currency', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['KES','USD','EUR','GBP'].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Order Date *</Label>
              <Input type="date" value={form.order_date} onChange={e => set('order_date', e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Expected Delivery</Label>
              <Input type="date" value={form.expected_date} onChange={e => set('expected_date', e.target.value)} />
            </div>
          </div>

          {/* Line items */}
          <div className="border rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Line Items</p>
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={addItem}>
                <Plus className="h-3 w-3" /> Add Item
              </Button>
            </div>
            <div className="space-y-2">
              {items.map((item, i) => (
                <div key={i} className="grid grid-cols-12 gap-1.5 items-end">
                  <div className="col-span-5">
                    {i === 0 && <Label className="text-[10px]">Description</Label>}
                    <Input placeholder="Item description" value={item.description} onChange={e => updateItem(i, 'description', e.target.value)} className="h-8 text-sm" />
                  </div>
                  <div className="col-span-2">
                    {i === 0 && <Label className="text-[10px]">Unit</Label>}
                    <Input placeholder="pcs" value={item.unit} onChange={e => updateItem(i, 'unit', e.target.value)} className="h-8 text-sm" />
                  </div>
                  <div className="col-span-2">
                    {i === 0 && <Label className="text-[10px]">Qty</Label>}
                    <Input type="number" min="0" step="0.001" value={item.quantity} onChange={e => updateItem(i, 'quantity', e.target.value)} className="h-8 text-sm font-mono" />
                  </div>
                  <div className="col-span-2">
                    {i === 0 && <Label className="text-[10px]">Unit Price</Label>}
                    <Input type="number" min="0" step="0.01" value={item.unit_price} onChange={e => updateItem(i, 'unit_price', e.target.value)} className="h-8 text-sm font-mono" />
                  </div>
                  <div className="col-span-1 flex justify-center">
                    {i === 0 && <Label className="text-[10px] opacity-0">Del</Label>}
                    <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive" onClick={() => items.length > 1 && removeItem(i)}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex justify-end pt-1 border-t">
              <div className="text-right">
                <span className="text-xs text-muted-foreground mr-2">Total:</span>
                <span className="font-mono font-bold">{kes(computedTotal)}</span>
              </div>
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-1">
            <Label>Notes</Label>
            <Textarea placeholder="Additional instructions, delivery notes…" value={form.notes} onChange={e => set('notes', e.target.value)} className="h-20" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Creating…' : 'Create PO'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─────────────────────────────────────────────────── PO Detail panel ── */
function PODetail({ po, token, onBack, onRefresh }: { po: any; token: string | null; onBack: () => void; onRefresh: () => void }) {
  const { toast } = useToast();
  const TRANSITIONS: Record<string, string[]> = {
    Draft: ['Submitted', 'Cancelled'],
    Submitted: ['Approved', 'Cancelled', 'Draft'],
    Approved: ['Received', 'Cancelled'],
    Received: [],
    Cancelled: ['Draft'],
  };
  const next = TRANSITIONS[po.status] ?? [];

  const doTransition = async (newStatus: string) => {
    try {
      const res = await fetch(`/api/procurement/orders/${po.id}/status/`, {
        method: 'PATCH',
        headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? res.statusText);
      toast({ title: `PO ${newStatus.toLowerCase()}` });
      onRefresh();
      onBack();
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    }
  };

  const items: any[] = po.items ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-bold text-base font-mono">{po.reference}</div>
          <div className="text-sm text-muted-foreground">{po.supplier_name}</div>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={po.status} />
          {next.map(s => (
            <Button key={s} size="sm" variant={s === 'Cancelled' ? 'destructive' : 'outline'}
              className="text-xs gap-1" onClick={() => doTransition(s)}>
              {s}
            </Button>
          ))}
          <Button size="sm" variant="ghost" onClick={onBack}><X className="h-4 w-4" /></Button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        {[
          ['Supplier Email', po.supplier_email || '—'],
          ['Supplier Phone', po.supplier_phone || '—'],
          ['Order Date', po.order_date || '—'],
          ['Expected Date', po.expected_date || '—'],
        ].map(([k, v]) => (
          <div key={k} className="border rounded p-2">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{k}</div>
            <div className="font-medium text-xs mt-0.5">{v}</div>
          </div>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Line Items</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead className="text-[10px] font-bold uppercase tracking-widest">Description</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-widest">Unit</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-widest text-right">Qty</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-widest text-right">Unit Price</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-widest text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center py-6 text-sm text-muted-foreground">No line items.</TableCell></TableRow>
              ) : items.map((item: any) => (
                <TableRow key={item.id} className="hover:bg-muted/30">
                  <TableCell className="py-2 text-sm">{item.description}</TableCell>
                  <TableCell className="py-2 text-xs text-muted-foreground">{item.unit}</TableCell>
                  <TableCell className="py-2 text-right font-mono text-xs">{Number(item.quantity).toLocaleString()}</TableCell>
                  <TableCell className="py-2 text-right font-mono text-xs">{kes(item.unit_price)}</TableCell>
                  <TableCell className="py-2 text-right font-mono text-sm font-bold">{kes(item.total)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex justify-end p-4 border-t gap-2">
            <span className="text-sm text-muted-foreground">Total ({po.currency}):</span>
            <span className="font-mono font-bold text-base">{kes(po.total_amount)}</span>
          </div>
        </CardContent>
      </Card>

      {po.notes && (
        <div className="border rounded p-3 text-sm text-muted-foreground bg-muted/30">
          <p className="text-[10px] font-bold uppercase tracking-widest mb-1">Notes</p>
          {po.notes}
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════ main ── */
export default function PurchaseOrders() {
  const { token } = useAuth();
  const qc = useQueryClient();
  const [newPOOpen, setNewPOOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedPO, setSelectedPO] = useState<any | null>(null);

  /* Dashboard */
  const { data: dashData } = useQuery({
    queryKey: ['procurement-dashboard'],
    queryFn: async () => {
      const res = await fetch('/api/procurement/dashboard/', { headers: { Authorization: `Token ${token}` } });
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    enabled: !!token,
    staleTime: 20_000,
  });

  /* PO list */
  const { data: poData, isLoading } = useQuery({
    queryKey: ['procurement-orders', search, statusFilter],
    queryFn: async () => {
      const qs = new URLSearchParams();
      if (search) qs.set('search', search);
      if (statusFilter) qs.set('status', statusFilter);
      const res = await fetch(`/api/procurement/orders/?${qs}`, { headers: { Authorization: `Token ${token}` } });
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    enabled: !!token,
    staleTime: 15_000,
  });

  const orders: any[] = poData?.results ?? [];
  const counts = dashData?.counts ?? {};

  const handleRefresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['procurement-orders'] });
    qc.invalidateQueries({ queryKey: ['procurement-dashboard'] });
  }, [qc]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 border-b pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <ShoppingCart className="h-6 w-6 text-primary" /> Procurement
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">Purchase orders and supplier management</p>
        </div>
        {!selectedPO ? (
          <Button size="sm" className="gap-1.5 font-bold uppercase tracking-wide text-xs" onClick={() => setNewPOOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> New PO
          </Button>
        ) : (
          <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={() => setSelectedPO(null)}>
            ← All Orders
          </Button>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: 'Total POs',  value: counts.total     ?? '—', color: 'text-foreground' },
          { label: 'Draft',      value: counts.draft      ?? '—', color: 'text-muted-foreground' },
          { label: 'Submitted',  value: counts.submitted  ?? '—', color: 'text-blue-600' },
          { label: 'Approved',   value: counts.approved   ?? '—', color: 'text-emerald-600' },
          { label: 'Received',   value: counts.received   ?? '—', color: 'text-purple-600' },
        ].map(s => (
          <Card key={s.label}>
            <CardContent className="p-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{s.label}</p>
              <p className={`text-xl font-bold font-mono ${s.color}`}>{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {selectedPO ? (
        <PODetail po={selectedPO} token={token} onBack={() => setSelectedPO(null)} onRefresh={handleRefresh} />
      ) : (
        <>
          {/* Filters */}
          <div className="flex items-center gap-2">
            <div className="bg-card border rounded-lg px-3 py-1.5 flex items-center gap-2 flex-1">
              <Search className="h-4 w-4 text-muted-foreground shrink-0" />
              <Input placeholder="Search by reference or supplier…" value={search} onChange={e => setSearch(e.target.value)}
                className="border-0 shadow-none focus-visible:ring-0 text-sm h-7" />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-36 h-9 text-sm">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">All statuses</SelectItem>
                {ALL_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* PO list */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-bold uppercase tracking-widest text-muted-foreground">
                Purchase Orders {!isLoading && `(${orders.length})`}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead className="text-[10px] font-bold uppercase tracking-widest">Reference</TableHead>
                    <TableHead className="text-[10px] font-bold uppercase tracking-widest">Supplier</TableHead>
                    <TableHead className="text-[10px] font-bold uppercase tracking-widest">Order Date</TableHead>
                    <TableHead className="text-[10px] font-bold uppercase tracking-widest">Expected</TableHead>
                    <TableHead className="text-[10px] font-bold uppercase tracking-widest">Status</TableHead>
                    <TableHead className="text-[10px] font-bold uppercase tracking-widest text-right">Amount</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <TableRow key={i}>{Array.from({ length: 7 }).map((_, j) => (
                        <TableCell key={j}><div className="h-4 bg-muted/60 rounded animate-pulse" /></TableCell>
                      ))}</TableRow>
                    ))
                  ) : orders.length ? orders.map((po: any) => (
                    <TableRow key={po.id} className="hover:bg-muted/30 cursor-pointer" onClick={() => setSelectedPO(po)}>
                      <TableCell className="py-2.5 font-mono font-bold text-sm">{po.reference}</TableCell>
                      <TableCell className="py-2.5 text-sm">
                        <div className="font-medium">{po.supplier_name}</div>
                        {po.supplier_email && <div className="text-xs text-muted-foreground">{po.supplier_email}</div>}
                      </TableCell>
                      <TableCell className="py-2.5 text-xs text-muted-foreground">{po.order_date}</TableCell>
                      <TableCell className="py-2.5 text-xs text-muted-foreground">{po.expected_date || '—'}</TableCell>
                      <TableCell className="py-2.5"><StatusBadge status={po.status} /></TableCell>
                      <TableCell className="py-2.5 text-right font-mono font-bold text-sm">{kes(po.total_amount)}</TableCell>
                      <TableCell className="py-2.5 text-right">
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </TableCell>
                    </TableRow>
                  )) : (
                    <TableRow>
                      <TableCell colSpan={7} className="py-12 text-center text-sm text-muted-foreground">
                        {search || statusFilter ? 'No purchase orders match your filter.' : (
                          <div className="space-y-2">
                            <ShoppingCart className="h-10 w-10 text-muted-foreground/30 mx-auto" />
                            <div>No purchase orders yet.</div>
                            <Button size="sm" onClick={() => setNewPOOpen(true)}>
                              <Plus className="h-3.5 w-3.5 mr-1.5" /> Create First PO
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}

      <NewPODialog
        open={newPOOpen}
        onOpenChange={setNewPOOpen}
        token={token}
        onSuccess={handleRefresh}
      />
    </div>
  );
}
