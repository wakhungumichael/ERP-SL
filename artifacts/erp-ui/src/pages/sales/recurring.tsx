import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
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
import { RefreshCw } from 'lucide-react';

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, '') ?? '';
const fmt = (v: number) => 'KES ' + Number(v ?? 0).toLocaleString('en-KE', { minimumFractionDigits: 2 });

const freqColors: Record<string, string> = {
  weekly: 'bg-blue-100 text-blue-700',
  monthly: 'bg-indigo-100 text-indigo-700',
  quarterly: 'bg-purple-100 text-purple-700',
  yearly: 'bg-violet-100 text-violet-700',
};

const statusColors: Record<string, string> = {
  active: 'bg-emerald-100 text-emerald-700',
  paused: 'bg-amber-100 text-amber-700',
  ended: 'bg-gray-100 text-gray-700',
};

interface RecurringInvoice {
  id: number;
  customer_name: string;
  frequency: string;
  next_invoice_date: string;
  start_date: string;
  total: number;
  status: string;
  notes: string;
}

function formatFrequency(value: string) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : 'Not set';
}

function formatStatus(value: string) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : 'Not set';
}

export default function RecurringPage() {
  const { token } = useAuth();
  const { toast } = useToast();

  const [filterStatus, setFilterStatus] = useState('');
  const [filterFreq, setFilterFreq] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState('10');
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    customer_name: '',
    frequency: 'monthly',
    start_date: '',
    next_invoice_date: '',
    notes: '',
  });

  const params = new URLSearchParams();
  if (filterStatus) params.set('status', filterStatus);
  if (filterFreq) params.set('frequency', filterFreq);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['recurring-invoices', token, filterStatus, filterFreq],
    enabled: !!token,
    queryFn: async () => {
      const r = await fetch(BASE_URL + '/api/sales/recurring-invoices/?' + params.toString(), {
        headers: { Authorization: 'Bearer ' + token },
      });
      if (!r.ok) throw new Error('fetch failed');
      return r.json();
    },
  });

  const records: RecurringInvoice[] = Array.isArray(data) ? data : (data?.results ?? []);
  const totalPages = Math.max(1, Math.ceil(records.length / Number(pageSize)));
  const visibleRecords = records.slice((page - 1) * Number(pageSize), page * Number(pageSize));

  const counts = {
    active: records.filter((r) => r.status === 'active').length,
    paused: records.filter((r) => r.status === 'paused').length,
    ended: records.filter((r) => r.status === 'ended').length,
  };

  async function handleCreate() {
    setSaving(true);
    try {
      const r = await fetch(BASE_URL + '/api/sales/recurring-invoices/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify(form),
      });
      if (!r.ok) throw new Error('Failed');
      toast({ title: 'Recurring invoice created' });
      refetch();
      setOpen(false);
      setPage(1);
      setForm({ customer_name: '', frequency: 'monthly', start_date: '', next_invoice_date: '', notes: '' });
    } catch {
      toast({ title: 'Error creating recurring invoice', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  async function handlePatch(id: number, status: string) {
    try {
      const r = await fetch(BASE_URL + '/api/sales/recurring-invoices/' + id + '/', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ status }),
      });
      if (!r.ok) throw new Error('Failed');
      toast({ title: 'Status updated' });
      refetch();
    } catch {
      toast({ title: 'Error updating status', variant: 'destructive' });
    }
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Repeat Billing</h1>
          <p className="text-sm text-muted-foreground">
            Keep scheduled customer billing clear, simple, and easy to act on.
          </p>
        </div>
        <Button onClick={() => setOpen(true)}>New billing plan</Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Active', value: counts.active },
          { label: 'Paused', value: counts.paused },
          { label: 'Ended', value: counts.ended },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="pt-4">
              <p className="text-2xl font-bold">{s.value}</p>
              <p className="text-sm text-muted-foreground">{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <Select value={filterStatus || '__all__'} onValueChange={(value) => { setFilterStatus(value === '__all__' ? '' : value); setPage(1); }}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="All plans" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All plans</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="paused">Paused</SelectItem>
            <SelectItem value="ended">Ended</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterFreq || '__all__'} onValueChange={(value) => { setFilterFreq(value === '__all__' ? '' : value); setPage(1); }}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="All cycles" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All cycles</SelectItem>
            <SelectItem value="weekly">Weekly</SelectItem>
            <SelectItem value="monthly">Monthly</SelectItem>
            <SelectItem value="quarterly">Quarterly</SelectItem>
            <SelectItem value="yearly">Yearly</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      {isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : records.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-2">
          <RefreshCw className="h-10 w-10 opacity-40" />
          <p>No recurring invoices found</p>
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead>Billing cycle</TableHead>
                <TableHead>Next invoice</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleRecords.map((rec) => (
                <TableRow key={rec.id} className="hover:bg-muted/50">
                  <TableCell className="font-medium">{rec.customer_name}</TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${freqColors[rec.frequency] ?? 'bg-gray-100 text-gray-700'}`}>
                      {formatFrequency(rec.frequency)}
                    </span>
                  </TableCell>
                  <TableCell>{rec.next_invoice_date || '—'}</TableCell>
                  <TableCell>{fmt(rec.total)}</TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[rec.status] ?? 'bg-gray-100 text-gray-700'}`}>
                      {formatStatus(rec.status)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      {rec.status === 'active' && (
                        <Button size="sm" variant="outline" onClick={() => handlePatch(rec.id, 'paused')}>
                          Pause
                        </Button>
                      )}
                      {rec.status === 'paused' && (
                        <Button size="sm" variant="outline" onClick={() => handlePatch(rec.id, 'active')}>
                          Resume
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {records.length > 0 ? (
        <div className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-muted-foreground">
            Showing page {page} of {totalPages} with {records.length} billing plans
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
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New billing plan</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Customer name *</Label>
              <Input value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} placeholder="Who should receive this repeating invoice?" />
            </div>
            <div>
              <Label>Billing cycle</Label>
              <Select value={form.frequency} onValueChange={(v) => setForm({ ...form, frequency: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="quarterly">Quarterly</SelectItem>
                  <SelectItem value="yearly">Yearly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Start date</Label>
                <Input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
              </div>
              <div>
                <Label>Next invoice date</Label>
                <Input type="date" value={form.next_invoice_date} onChange={(e) => setForm({ ...form, next_invoice_date: e.target.value })} />
              </div>
            </div>
            <div>
              <Label>Billing notes</Label>
              <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={saving || !form.customer_name}>
              {saving ? 'Saving…' : 'Create plan'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
