import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Plus, Search, Mail, Phone, Clock } from 'lucide-react';

const API = (path: string, opts: RequestInit = {}) => {
  const token = localStorage.getItem('sl-erp-token');
  return fetch(`/api/crm${path}`, { ...opts, headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json', ...(opts.headers as any) } });
};

const TERMS_BADGE: Record<string, string> = {
  immediate: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  net_15:    'bg-blue-100 text-blue-800 border-blue-300',
  net_30:    'bg-amber-100 text-amber-800 border-amber-300',
  net_60:    'bg-orange-100 text-orange-800 border-orange-300',
  net_90:    'bg-red-100 text-red-800 border-red-300',
};

export default function SuppliersPage() {
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['crm-suppliers', search],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      const res = await API(`/suppliers/?${params}`);
      return res.json();
    },
  });

  const suppliers = Array.isArray(data) ? data : data?.results ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b pb-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Suppliers</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage the suppliers and vendors your business buys from.</p>
        </div>
        <AddSupplierDialog />
      </div>

      <div className="flex items-center gap-2 max-w-sm bg-card border rounded-lg px-3 shadow-sm">
        <Search className="h-4 w-4 text-muted-foreground shrink-0" />
        <Input placeholder="Search suppliers or contacts…" value={search} onChange={e => setSearch(e.target.value)}
          className="h-9 border-0 shadow-none focus-visible:ring-0 text-sm" />
      </div>

      <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead>Supplier Name</TableHead>
                <TableHead>Contact Person</TableHead>
                <TableHead>Contact Details</TableHead>
                <TableHead>Payment Terms</TableHead>
                <TableHead>Account Number</TableHead>
              </TableRow>
            </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={5} className="text-center py-12 text-sm text-muted-foreground animate-pulse">Loading suppliers…</TableCell></TableRow>
            ) : suppliers.length ? suppliers.map((s: any) => (
              <TableRow key={s.id} className="hover:bg-muted/30 transition-colors">
                <TableCell className="font-bold">{s.name}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{s.contact_person || '—'}</TableCell>
                <TableCell>
                  <div className="space-y-0.5">
                    {s.email && <div className="flex items-center gap-1 text-xs text-muted-foreground"><Mail className="h-3 w-3" />{s.email}</div>}
                    {s.phone && <div className="flex items-center gap-1 text-xs text-muted-foreground font-mono"><Phone className="h-3 w-3" />{s.phone}</div>}
                  </div>
                </TableCell>
                <TableCell>
                  <span className={`flex items-center gap-1.5 w-fit px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide border ${TERMS_BADGE[s.payment_terms] ?? 'bg-secondary border-border'}`}>
                    <Clock className="h-3 w-3" />{s.payment_terms_display}
                  </span>
                </TableCell>
                <TableCell className="font-mono text-sm text-muted-foreground">{s.account_number || '—'}</TableCell>
              </TableRow>
            )) : (
              <TableRow><TableCell colSpan={5} className="text-center py-16 text-sm text-muted-foreground">No suppliers yet. Add your first one.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function AddSupplierDialog() {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: '', contact_person: '', email: '', phone: '', address: '', payment_terms: 'net_30', account_number: '' });
  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm(p => ({ ...p, [k]: e.target.value }));

  const save = useMutation({
    mutationFn: () => API('/suppliers/', { method: 'POST', body: JSON.stringify(form) }).then(r => r.json()),
    onSuccess: () => {
      toast({ title: 'Supplier added' });
      qc.invalidateQueries({ queryKey: ['crm-suppliers'] });
      qc.invalidateQueries({ queryKey: ['crm-dashboard'] });
      setOpen(false);
      setForm({ name: '', contact_person: '', email: '', phone: '', address: '', payment_terms: 'net_30', account_number: '' });
    },
    onError: () => toast({ title: 'Could not save supplier', variant: 'destructive' }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2 font-bold uppercase tracking-wide"><Plus className="h-4 w-4" /> Add Supplier</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader><DialogTitle className="font-bold uppercase tracking-widest">New Supplier</DialogTitle></DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Supplier Name *</label>
            <Input value={form.name} onChange={f('name')} placeholder="ABC Supplies Ltd." className="font-medium" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Contact Person</label>
              <Input value={form.contact_person} onChange={f('contact_person')} placeholder="John Doe" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Account Number</label>
              <Input value={form.account_number} onChange={f('account_number')} placeholder="Your account reference with this supplier" className="font-mono text-sm" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Email</label>
              <Input type="email" value={form.email} onChange={f('email')} placeholder="orders@supplier.com" className="font-mono text-sm" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Phone</label>
              <Input value={form.phone} onChange={f('phone')} placeholder="+254 700 000 000" className="font-mono text-sm" />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Payment Terms</label>
            <Select value={form.payment_terms} onValueChange={v => setForm(p => ({ ...p, payment_terms: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="immediate">Pay on Receipt</SelectItem>
                <SelectItem value="net_15">Net 15 Days</SelectItem>
                <SelectItem value="net_30">Net 30 Days</SelectItem>
                <SelectItem value="net_60">Net 60 Days</SelectItem>
                <SelectItem value="net_90">Net 90 Days</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Address</label>
            <Input value={form.address} onChange={f('address')} placeholder="Physical address" />
          </div>
          <Button onClick={() => save.mutate()} className="w-full font-bold uppercase tracking-widest" disabled={!form.name || save.isPending}>
            {save.isPending ? 'Saving…' : 'Add Supplier'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
