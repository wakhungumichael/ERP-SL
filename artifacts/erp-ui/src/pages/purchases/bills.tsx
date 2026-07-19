import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/context/use-auth';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, '') ?? '';
const fmt = (v: number) => 'KES ' + Number(v ?? 0).toLocaleString('en-KE', { minimumFractionDigits: 2 });

type LineItem = { description: string; quantity: number; unit_price: number; tax_rate: number };
type Bill = {
  id: number;
  bill_number?: string;
  supplier_name: string;
  reference?: string;
  issue_date: string;
  due_date: string;
  total_amount?: number;
  status: string;
  notes?: string;
};

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  received: 'bg-blue-100 text-blue-700',
  approved: 'bg-emerald-100 text-emerald-700',
  paid: 'bg-teal-100 text-teal-700',
  overdue: 'bg-red-100 text-red-700',
};

const emptyLine = (): LineItem => ({ description: '', quantity: 1, unit_price: 0, tax_rate: 0 });

const emptyForm = () => ({
  supplier_name: '',
  reference: '',
  issue_date: '',
  due_date: '',
  notes: '',
});

export default function BillsPage() {
  const { token } = useAuth();
  const { toast } = useToast();

  const [filterStatus, setFilterStatus] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [lines, setLines] = useState<LineItem[]>([emptyLine()]);
  const [saving, setSaving] = useState(false);

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
        headers: { Authorization: 'Bearer ' + token },
      });
      if (!r.ok) throw new Error('fetch failed');
      return r.json();
    },
  });

  const bills: Bill[] = Array.isArray(data) ? data : (data?.bills ?? data?.results ?? []);

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
  const addLine = () => setLines((prev) => [...prev, emptyLine()]);
  const removeLine = (idx: number) => setLines((prev) => prev.filter((_, i) => i !== idx));

  const lineTotal = (l: LineItem) => l.quantity * l.unit_price;
  const lineTax = (l: LineItem) => lineTotal(l) * (l.tax_rate / 100);
  const subtotal = lines.reduce((s, l) => s + lineTotal(l), 0);
  const totalTax = lines.reduce((s, l) => s + lineTax(l), 0);
  const grandTotal = subtotal + totalTax;

  function openCreate() {
    setForm(emptyForm());
    setLines([emptyLine()]);
    setOpen(true);
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
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ ...form, line_items: lines }),
      });
      if (!r.ok) throw new Error('Failed');
      toast({ title: 'Bill created successfully' });
      refetch();
      setOpen(false);
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
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ status }),
      });
      if (!r.ok) throw new Error('Failed');
      toast({ title: `Bill marked as ${status}` });
      refetch();
    } catch {
      toast({ title: 'Error updating bill', variant: 'destructive' });
    }
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Bills</h1>
        <Button onClick={openCreate}>+ New Bill</Button>
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
          <Select value={filterStatus} onValueChange={setFilterStatus}>
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
          <Label className="text-xs">Date From</Label>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-8 text-sm w-36" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Date To</Label>
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-8 text-sm w-36" />
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
                  <TableHead>Issue Date</TableHead>
                  <TableHead>Due Date</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bills.map((b) => (
                  <TableRow key={b.id} className="hover:bg-muted/50">
                    <TableCell className="font-mono text-sm">{b.bill_number ?? `#${b.id}`}</TableCell>
                    <TableCell>{b.supplier_name}</TableCell>
                    <TableCell>{b.issue_date}</TableCell>
                    <TableCell>{b.due_date}</TableCell>
                    <TableCell className="text-right">{fmt((b as any).total ?? (b as any).total_amount ?? 0)}</TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[b.status] ?? 'bg-gray-100 text-gray-700'}`}>
                        {b.status}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {(b.status === 'draft' || b.status === 'received') && (
                          <Button size="sm" variant="outline" onClick={() => handlePatch(b.id, 'approved')}>
                            Approve
                          </Button>
                        )}
                        {b.status === 'approved' && (
                          <Button size="sm" variant="outline" onClick={() => handlePatch(b.id, 'paid')}>
                            Mark Paid
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Bill</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Top fields */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1 col-span-2 sm:col-span-1">
                <Label>Supplier Name <span className="text-red-500">*</span></Label>
                <Input value={form.supplier_name} onChange={(e) => setForm({ ...form, supplier_name: e.target.value })} placeholder="Supplier name" />
              </div>
              <div className="space-y-1 col-span-2 sm:col-span-1">
                <Label>Reference</Label>
                <Input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder="e.g. INV-001" />
              </div>
              <div className="space-y-1">
                <Label>Issue Date</Label>
                <Input type="date" value={form.issue_date} onChange={(e) => setForm({ ...form, issue_date: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>Due Date</Label>
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
                <Button type="button" size="sm" variant="outline" onClick={addLine}>+ Add Line</Button>
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
            <Button onClick={handleCreate} disabled={saving}>{saving ? 'Saving…' : 'Save Bill'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
