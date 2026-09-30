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
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Building2, ChevronLeft, ChevronRight, Pencil, Plus, Users } from 'lucide-react';
import { hasPermission } from '@/lib/permissions';

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, '') ?? '';

interface Customer {
  id: number;
  name: string;
  phone_number: string;
  email: string;
  address: string;
  transaction_count: number;
  invoice_count: number;
}

type FormState = {
  name: string;
  phone_number: string;
  email: string;
  address: string;
};

const emptyForm = (): FormState => ({
  name: '',
  phone_number: '',
  email: '',
  address: '',
});

export default function CustomersPage() {
  const { token, user } = useAuth();
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editTarget, setEditTarget] = useState<Customer | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const canAddCustomer = hasPermission(user as any, 'SL_Weighbridge.add_customer');
  const canChangeCustomer = hasPermission(user as any, 'SL_Weighbridge.change_customer');

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['sales-customers', token, search],
    enabled: !!token,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      const r = await fetch(BASE_URL + '/api/sales/customers/?' + params.toString(), {
        headers: { Authorization: 'Token ' + token },
      });
      if (!r.ok) throw new Error('fetch failed');
      return r.json();
    },
  });

  const customers: Customer[] = data?.customers ?? [];
  const totalPages = Math.max(1, Math.ceil(customers.length / pageSize));
  const pagedCustomers = customers.slice((page - 1) * pageSize, page * pageSize);

  const stats = {
    total: customers.length,
    withInvoices: customers.filter((c) => c.invoice_count > 0).length,
    withTransactions: customers.filter((c) => c.transaction_count > 0).length,
  };

  function openCreate() {
    setEditTarget(null);
    setForm(emptyForm());
    setOpen(true);
  }

  function openEdit(customer: Customer) {
    setEditTarget(customer);
    setForm({
      name: customer.name ?? '',
      phone_number: customer.phone_number ?? '',
      email: customer.email ?? '',
      address: customer.address ?? '',
    });
    setOpen(true);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const payload = {
        ...form,
        email: form.email || null,
      };
      const url = editTarget
        ? BASE_URL + '/api/sales/customers/' + editTarget.id + '/'
        : BASE_URL + '/api/sales/customers/';
      const method = editTarget ? 'PATCH' : 'POST';
      const r = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: 'Token ' + token },
        body: JSON.stringify(payload),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        const message = body?.phone_number?.[0] || body?.email?.[0] || body?.name?.[0] || body?.error || 'Failed to save customer';
        throw new Error(message);
      }
      toast({ title: editTarget ? 'Customer updated' : 'Customer created' });
      setOpen(false);
      setForm(emptyForm());
      setEditTarget(null);
      setPage(1);
      refetch();
    } catch (error: any) {
      toast({ title: 'Save failed', description: error?.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Customers</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage shared customer records used across CRM, sales, invoices, and operations.
          </p>
        </div>
        {canAddCustomer ? (
          <Button onClick={openCreate} className="gap-2">
            <Plus className="h-4 w-4" />
            New Customer
          </Button>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-4">
            <p className="text-2xl font-bold">{stats.total}</p>
            <p className="text-sm text-muted-foreground">Customer records</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-2xl font-bold">{stats.withTransactions}</p>
            <p className="text-sm text-muted-foreground">Used in operations</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-2xl font-bold">{stats.withInvoices}</p>
            <p className="text-sm text-muted-foreground">With invoices or statements</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="max-w-sm">
          <Input
            placeholder="Search by name, phone, or email…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Rows:</span>
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
        {customers.length} customer record{customers.length !== 1 ? 's' : ''} found
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : customers.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-2">
          <Users className="h-10 w-10 opacity-40" />
          <p>No customers found</p>
        </div>
      ) : (
        <>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Usage</TableHead>
                  {canChangeCustomer ? <TableHead>Actions</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagedCustomers.map((customer) => (
                  <TableRow key={customer.id} className="hover:bg-muted/50">
                    <TableCell>
                      <div className="space-y-1">
                        <div className="font-medium">{customer.name}</div>
                        <div className="text-xs text-muted-foreground">{customer.address || 'No address set'}</div>
                      </div>
                    </TableCell>
                    <TableCell>{customer.phone_number || '—'}</TableCell>
                    <TableCell>{customer.email || '—'}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="secondary" className="gap-1">
                          <Building2 className="h-3 w-3" />
                          {customer.transaction_count} operations
                        </Badge>
                        <Badge variant="outline">{customer.invoice_count} invoices</Badge>
                      </div>
                    </TableCell>
                    {canChangeCustomer ? (
                      <TableCell>
                        <Button size="sm" variant="ghost" onClick={() => openEdit(customer)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              Showing {Math.min((page - 1) * pageSize + 1, customers.length)}-{Math.min(page * pageSize, customers.length)} of {customers.length}
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
        </>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editTarget ? 'Edit Customer' : 'New Customer'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label>Name *</Label>
                <Input value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} />
              </div>
              <div>
                <Label>Phone *</Label>
                <Input value={form.phone_number} onChange={(e) => setForm((prev) => ({ ...prev, phone_number: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label>Email</Label>
              <Input type="email" value={form.email} onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))} />
            </div>
            <div>
              <Label>Address</Label>
              <Textarea rows={4} value={form.address} onChange={(e) => setForm((prev) => ({ ...prev, address: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={saving} onClick={handleSave}>
              {saving ? 'Saving…' : editTarget ? 'Save Changes' : 'Create Customer'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
