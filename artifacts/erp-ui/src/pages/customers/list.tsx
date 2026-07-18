import { useState } from 'react';
import { useListCustomers, getListCustomersQueryKey, useCreateCustomer } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Search, Mail, Phone } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';

export default function CustomersList() {
  const [search, setSearch] = useState('');
  const { data, isLoading } = useListCustomers(
    { search },
    { query: { queryKey: getListCustomersQueryKey({ search }) } },
  );

  const customers = Array.isArray(data) ? data : (data as any)?.results ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b pb-4">
        <h1 className="text-3xl font-bold tracking-tight">Customer Directory</h1>
        <CreateCustomerDialog />
      </div>

      <div className="flex gap-4 items-center max-w-sm">
        <div className="relative w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search directory…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 bg-card border-border shadow-sm font-mono text-sm"
          />
        </div>
      </div>

      <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="w-16">ID</TableHead>
              <TableHead>Entity Name</TableHead>
              <TableHead>Contact Email</TableHead>
              <TableHead>Phone Number</TableHead>
              <TableHead className="text-center">Discounted</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-12 font-mono text-sm text-muted-foreground animate-pulse">
                  Scanning records…
                </TableCell>
              </TableRow>
            ) : customers.length ? (
              customers.map((c: any) => (
                <TableRow key={c.id} className="hover:bg-muted/30 transition-colors">
                  <TableCell className="font-mono text-muted-foreground">{String(c.id).padStart(4, '0')}</TableCell>
                  <TableCell className="font-bold">{c.name}</TableCell>
                  <TableCell>
                    {c.email
                      ? <span className="flex items-center gap-2 text-sm text-muted-foreground"><Mail className="h-3 w-3" />{c.email}</span>
                      : '—'}
                  </TableCell>
                  <TableCell>
                    {/* Backend field is phone_number */}
                    {c.phone_number
                      ? <span className="flex items-center gap-2 text-sm text-muted-foreground font-mono"><Phone className="h-3 w-3" />{c.phone_number}</span>
                      : '—'}
                  </TableCell>
                  <TableCell className="text-center">
                    {c.discounted
                      ? <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide bg-emerald-100 text-emerald-800 border border-emerald-300 dark:bg-emerald-900/30 dark:text-emerald-400">Yes</span>
                      : <span className="text-muted-foreground text-xs">—</span>}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-16 font-mono text-sm text-muted-foreground">
                  No entity records found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function CreateCustomerDialog() {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const create = useCreateCustomer();
  // Backend expects phone_number not phone
  const [formData, setFormData] = useState({ name: '', email: '', phone_number: '' });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    create.mutate({ data: formData as any }, {
      onSuccess: () => {
        toast({ title: 'Entity Registered' });
        queryClient.invalidateQueries({ queryKey: getListCustomersQueryKey() });
        setOpen(false);
        setFormData({ name: '', email: '', phone_number: '' });
      },
      onError: () => toast({ title: 'Registration Failed', variant: 'destructive' }),
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2 font-bold uppercase tracking-wide"><Plus className="h-4 w-4" /> Register Entity</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="font-bold uppercase tracking-widest">New Customer Entity</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-6 pt-4">
          <div className="grid gap-4">
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Entity Legal Name</label>
              <Input
                value={formData.name}
                onChange={e => setFormData({ ...formData, name: e.target.value })}
                required className="font-medium" placeholder="Acme Logistics Corp."
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Email Address</label>
              <Input
                type="email" value={formData.email}
                onChange={e => setFormData({ ...formData, email: e.target.value })}
                className="font-mono text-sm" placeholder="contact@acme.inc"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Phone Number</label>
              <Input
                value={formData.phone_number}
                onChange={e => setFormData({ ...formData, phone_number: e.target.value })}
                className="font-mono text-sm" placeholder="+254 700 000 000"
              />
            </div>
          </div>
          <Button type="submit" className="w-full font-bold uppercase tracking-widest" disabled={create.isPending}>
            {create.isPending ? 'Registering…' : 'Confirm Registration'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
